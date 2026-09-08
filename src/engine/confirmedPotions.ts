import { raceIds, type CandidateCard, type EvaluationContext, type EvaluationResult, type GameState, type PersistentLoadout } from '../types/game'
import { confirmedPotions } from '../planner/confirmedPotions'
import { previewPassives, type PassivePreview } from './sharedPassives'
import { evaluateStrategicState } from './strategy'
import { persistentCardsIn } from './persistent'

const total = (s: GameState) => s.monsters.reduce((sum, m) => sum + (m.race ? m.quantity * m.unitActivity : 0), 0)
const range = (p: PassivePreview, source: GameState) => {
  const values = p.outcomes.map(o => total(o.state))
  return values.length ? { minimum: Math.min(...values), maximum: Math.max(...values) }
    : { minimum: total(source), maximum: total(source) }
}

export function evaluateConfirmedPotion(source: GameState, card: CandidateCard, loadout: PersistentLoadout,
  context: EvaluationContext): EvaluationResult {
  const rule = confirmedPotions.find(p => p.id === card.id)!
  const targets = rule.targeting?.mode === 'choose' ? context.selectedMonsterIds ?? [] : []
  const phase = { card: rule, targets, includeRoundEnd: false }
  const immediate = previewPassives(source, loadout, [], {}, {}, phase)
  const final = immediate.unavailable ? immediate
    : previewPassives(source, loadout, [], {}, {}, { ...phase, includeRoundEnd: true })
  const baseline = previewPassives(source, loadout, [{ type: 'roundEnd', source: 'round', round: source.round }])
  const unsupported = persistentCardsIn(loadout).find(p => p.id !== 'none' && !p.sharedRules)
  const unavailable = immediate.unavailable || final.unavailable || baseline.unavailable
    || (unsupported ? `${unsupported.name}为旧示例效果，尚未接入已校准药剂的共享事件模型` : undefined)
  const now = range(immediate, source), end = range(final, source), beforeEnd = range(baseline, source)
  const scoreState = (s: GameState) => source.mode === 'strategic' ? evaluateStrategicState(s, loadout).value
    : source.mode === 'preserve' ? total(s) + s.monsters.filter(m => m.race).length * 12
      - source.monsters.filter(m => m.race && !s.monsters.some(n => n.id === m.id && n.race)).length * 30 : total(s)
  const minimumScore = (p: PassivePreview) => p.outcomes.length
    ? Math.min(...p.outcomes.map(o => scoreState(o.state))) : scoreState(source)
  const score = minimumScore(final), beforeScore = minimumScore(baseline)
  const details = [...new Set([...immediate.warnings, ...final.warnings])]
  const exhaustive = immediate.exhaustive && final.exhaustive
  const summary = `药剂及即时常驻 ${now.minimum}–${now.maximum}；本轮结束 ${end.minimum}–${end.maximum}。${exhaustive ? '已枚举合法分支' : '有界抽样，仅为样本范围，不是真实保底'}。`
  return {
    card, state: structuredClone(source), requiresOutcomeSync: true, modelUnavailable: unavailable, sampledOutcomes: !exhaustive,
    activityBefore: total(source), activityAfter: now.minimum, delta: now.minimum - total(source),
    activityRange: unavailable ? undefined : now,
    raceGroupRange: immediate.outcomes.length ? Object.fromEntries(raceIds.map(race => {
      const counts = immediate.outcomes.map(o => o.state.monsters.filter(m => m.race === race).length)
      return [race, { minimum: Math.min(...counts), maximum: Math.max(...counts) }]
    })) : undefined,
    score, scoreDelta: score - beforeScore,
    scoreLabel: exhaustive ? '保守本轮评分' : '抽样参考评分',
    settlement: { unavailable, uncertain: true, beforeBonus: beforeEnd.minimum - total(source),
      afterBonus: end.minimum - now.minimum,
      change: end.minimum - now.minimum - (beforeEnd.minimum - total(source)),
      projectedActivity: end.minimum, details: [summary, ...details,
        '各阶段端点用于比较，不保证属于同一随机路径；实际状态不写回，游戏使用后F8同步。'] },
    trace: [summary, ...details], warnings: unavailable ? [unavailable] : details,
    analysis: [summary, `参与常驻：${persistentCardsIn(loadout).map(p => p.name).join('、') || '无'}`,
      '机制按2026-09-08用户确认；随机出率尚未确认，不把抽样最小值当作保证。',
      '新怪基础数据在设置中导入 rarityBases；旧单一新蛊虫配置不能代表随机四稀有度。'],
  }
}
