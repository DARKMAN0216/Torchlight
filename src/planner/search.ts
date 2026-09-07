import { seededRandom, type Random } from './random'
import { actionKey, finalActivity, getLegalActions, simulateAction, validateState } from './simulator'
import { ModelUnavailableError, type GameAction, type PlannerModel, type PlannerState } from './types'

export interface SearchOptions {
  seed: number
  simulations: number
  policySamples: number
  beamWidth: number
  /** 0 = sampled greedy rollout; 1+ = action beam with terminal rollout reranking. */
  policyDepth: number
  maxTransitions: number
}
export const defaultSearchOptions: SearchOptions = {
  seed: 20260907, simulations: 64, policySamples: 2, beamWidth: 3, policyDepth: 1, maxTransitions: 250000,
}
export interface ActionEstimate {
  action: GameAction
  mean: number
  median: number
  p10: number
  p90: number
  standardError: number
  simulations: number
  modelConfidence: 'low' | 'conditional'
  warnings: string[]
}
export interface SearchReport {
  modelVersion: string
  poolLabel: string
  seed: number
  options: SearchOptions
  status: 'complete' | 'blocked' | 'budgetExceeded'
  recommendation?: GameAction
  estimates: ActionEstimate[]
  issues: string[]
  assumptions: string[]
  transitions: number
  elapsedMs: number
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
export function summarize(values: number[]) {
  if (!values.length) throw new Error('没有完整终局样本')
  const ordered = [...values].sort((a, b) => a - b)
  const average = mean(values)
  const quantile = (p: number) => {
    const i = (ordered.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (i - lo)
  }
  const variance = values.length < 2 ? 0 : values.reduce((s, v) => s + (v - average) ** 2, 0) / (values.length - 1)
  return { mean: average, median: quantile(.5), p10: quantile(.1), p90: quantile(.9),
    standardError: Math.sqrt(variance / values.length), simulations: values.length }
}
class BudgetExceeded extends Error {}

/**
 * Monte Carlo policy evaluation. Beam pruning applies to ACTIONS by sample means,
 * never to chance outcomes. Policy simulations use RNG independent of the played
 * trajectory; an action cannot inspect the future actual offer or random outcome.
 */
export function recommend(
  state: PlannerState, model: PlannerModel, overrides: Partial<SearchOptions> = {},
): SearchReport {
  const options = { ...defaultSearchOptions, ...overrides }
  for (const key of ['simulations', 'policySamples', 'beamWidth', 'maxTransitions'] as const)
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error('搜索参数无效：' + key)
  if (!Number.isInteger(options.policyDepth) || options.policyDepth < 0 || options.policyDepth > 2)
    throw new Error('policyDepth 必须为 0、1 或 2')
  if (!Number.isSafeInteger(options.seed)) throw new Error('随机种子无效')
  const start = Date.now()
  const report: SearchReport = {
    modelVersion: model.version, poolLabel: model.poolLabel, seed: options.seed, options,
    status: 'complete', estimates: [], issues: [], assumptions: [...model.assumptions],
    transitions: 0, elapsedMs: 0,
  }
  const warnings = new Set<string>()
  const step = (s: PlannerState, a: GameAction, random: Random) => {
    if (++report.transitions > options.maxTransitions) throw new BudgetExceeded('达到状态转移预算')
    const result = simulateAction(s, a, model, random)
    result.warnings.forEach(w => warnings.add(w))
    return result.state
  }
  const nextSeed = (random: Random) => Math.floor(random() * 0x100000000)
  const rollout = (initial: PlannerState, environment: Random, policyRandom: Random, depth: number): number => {
    let current = initial
    while (current.round <= 13) {
      const action = choose(current, policyRandom, depth)
      current = step(current, action, environment)
    }
    return finalActivity(current)
  }
  const choose = (current: PlannerState, policyRandom: Random, depth: number): GameAction => {
    const actions = getLegalActions(current, model)
    if (!actions.length) throw new ModelUnavailableError('当前局面没有合法动作')
    if (actions.length === 1) return actions[0]
    const scoringSeeds = Array.from({ length: options.policySamples }, () => nextSeed(policyRandom))
    const screened = actions.map(action => ({
      action, score: mean(scoringSeeds.map(seed => finalActivity(step(current, action, seededRandom(seed))))),
    })).sort((a, b) => b.score - a.score || actionKey(a.action).localeCompare(actionKey(b.action)))
    if (depth === 0) return screened[0].action
    const evaluationSeeds = Array.from({ length: options.policySamples }, () => nextSeed(policyRandom))
    const beam = screened.slice(0, options.beamWidth).map(({ action }) => ({
      action,
      score: mean(evaluationSeeds.map(seed => {
        const env = seededRandom(seed)
        return rollout(step(current, action, env), env, seededRandom(seed ^ 0xA51C), depth - 1)
      })),
    }))
    beam.sort((a, b) => b.score - a.score || actionKey(a.action).localeCompare(actionKey(b.action)))
    return beam[0].action
  }
  try {
    validateState(state)
    // Fail closed on known pool holes even if finite sampling happens not to encounter them.
    if (state.round < 10 || (state.round === 10 && state.redrawsRemaining > 0)) {
      for (const id of model.offerPool) {
        const card = model.cards.find(c => c.id === id)
        if (!card || card.unsupportedReason)
          throw new ModelUnavailableError('未来牌池未完整建模：' + id + '；请补规则或明确指定实验牌池')
      }
    }
    const actions = getLegalActions(state, model)
    if (!actions.length) throw new ModelUnavailableError('已结束或没有合法动作')
    for (const action of actions) {
      warnings.clear()
      const values: number[] = []
      for (let i = 0; i < options.simulations; i++) {
        const seed = (options.seed + Math.imul(i + 1, 0x9E3779B9)) >>> 0
        const env = seededRandom(seed)
        const after = step(state, action, env)
        values.push(rollout(after, env, seededRandom(seed ^ 0x7F4A7C15), options.policyDepth))
      }
      report.estimates.push({
        action, ...summarize(values), modelConfidence: warnings.size ? 'low' : 'conditional', warnings: [...warnings],
      })
    }
    report.estimates.sort((a, b) => b.mean - a.mean || actionKey(a.action).localeCompare(actionKey(b.action)))
    report.recommendation = report.estimates[0]?.action
  } catch (error) {
    if (!(error instanceof ModelUnavailableError) && !(error instanceof BudgetExceeded)) throw error
    report.status = error instanceof BudgetExceeded ? 'budgetExceeded' : 'blocked'
    report.issues.push(error.message)
    // A partial set of actions must never masquerade as a global recommendation.
    delete report.recommendation
  }
  report.elapsedMs = Date.now() - start
  return report
}

export function checkOrderSensitivity(
  state: PlannerState, model: PlannerModel, options: Partial<SearchOptions> = {},
) {
  const orders = ['acquisition', 'reverse', 'random'] as const
  const scenarios = orders.map(order => ({
    order, report: recommend(state, { ...model, persistentOrder: order }, options),
  }))
  const complete = scenarios.every(s => s.report.status === 'complete')
  const keys = scenarios.flatMap(s => s.report.recommendation ? [actionKey(s.report.recommendation)] : [])
  return { status: !complete ? 'incomplete' : new Set(keys).size > 1 ? 'sensitive' : 'stable',
    note: '仅检查获得顺序、反向和随机排列抽样；稳定不代表穷尽全部顺序，也不排除采样噪声。',
    scenarios }
}
