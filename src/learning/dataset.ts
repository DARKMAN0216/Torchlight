import { raceIds, rarityIds } from '../types/game'
import { activity, frameIssues, stepIssues, terminalLearningIssues, validateArchive, type RunArchive, type RunFrame } from './archive'

export function frameTags(frame: RunFrame): string[] {
  const groups = frame.state.monsters.filter(m => m.race)
  return [
    `phase:${frame.phase}`, `round:${frame.state.round}`,
    `groups:${groups.length}`,
    `loadout:${frame.passives.map(p => p.cardId).sort().join('+') || 'none'}`,
    ...[...new Set(groups.map(m => `race:${m.race}`))].sort(),
    ...[...new Set(groups.map(m => `rarity:${m.rarity}`))].sort(),
    ...frame.passives.map(p => `passive:${p.cardId}`).sort(),
    ...(frame.passives.some(p => p.cardId === 'human-pupa') && !groups.some(m => m.race === 'swarm') ? ['route:pupa-without-swarm'] : []),
  ]
}
/** These are visible changes, NOT inferred removal/addition/mutation trigger counts. */
export function observedChanges(before: RunFrame, after: RunFrame): string[] {
  const changes = new Set<string>()
  before.state.monsters.forEach((m, i) => {
    const n = after.state.monsters[i]
    if (m.race && !n.race) changes.add('observed:slot-emptied')
    if (!m.race && n.race) changes.add('observed:slot-filled')
    if (m.race && n.race && m.race !== n.race) changes.add('observed:race-changed')
    if (m.race && n.race && m.rarity !== n.rarity) changes.add('observed:rarity-changed')
    if (m.race && n.race && (m.quantity !== n.quantity || m.unitActivity !== n.unitActivity)) changes.add('observed:stats-changed')
  })
  return [...changes].sort()
}
const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
export function classifyRuns(runs: RunArchive[]) {
  const runIds = new Set<string>(), counts = new Map<string, number>()
  const reports = runs.map(run => {
    validateArchive(run)
    if (runIds.has(run.runId)) throw new Error('重复runId，不能重复计数')
    runIds.add(run.runId)
    const frames = new Map<string, RunFrame>()
    run.steps.forEach(s => { frames.set(s.before.id, s.before); if (s.after) frames.set(s.after.id, s.after) })
    const tags = new Set<string>(), seenOffers = new Set<string>()
    const offers = new Map<string, number>(), choices = new Map<string, number>()
    let reliableSteps = 0
    for (const frame of frames.values()) {
      if (frameIssues(frame).length) continue
      frameTags(frame).forEach(tag => tags.add(tag))
      // An unchanged screenshot is not a new draw. New draw with same cards has a new offerId.
      if (frame.offerId && frame.offersComplete && !seenOffers.has(frame.offerId)) {
        seenOffers.add(frame.offerId)
        for (const card of frame.offered) count(offers, card.cardId ? 'id:' + card.cardId : 'name:' + card.name)
      }
    }
    const steps = run.steps.map(s => {
      const issues = stepIssues(s)
      if (!issues.length) {
        reliableSteps++
        if (s.action.cardName || s.action.cardId) count(choices, s.action.cardId ? 'id:' + s.action.cardId : 'name:' + s.action.cardName)
        if (s.after) observedChanges(s.before, s.after).forEach(tag => tags.add(tag))
      }
      tags.add('action:' + s.action.type)
      return { id: s.id, observationPairUsable: !issues.length, issues }
    })
    for (const tag of tags) count(counts, `${run.provenance}/${tag}`)
    const terminalIssues = terminalLearningIssues(run)
    return { runId: run.runId, provenance: run.provenance, gameVersion: run.gameVersion,
      rulesVersion: run.rulesVersion, status: run.end.kind,
      tags: [...tags].sort(), steps, reliableSteps, observedOffers: seenOffers.size,
      offeredCounts: Object.fromEntries(offers), chosenCounts: Object.fromEntries(choices),
      lastObservedActivity: run.steps.at(-1)?.after ? activity(run.steps.at(-1)!.after!) : null,
      terminalActivity: run.end.kind === 'confirmed-terminal' ? activity(run.end.frame!) : null,
      terminalLearningEligible: terminalIssues.length === 0, terminalIssues,
    }
  })
  return { schemaVersion: 1, runs: reports, tagCounts: Object.fromEntries(counts),
    totals: { runs: runs.length, real: runs.filter(r => r.provenance === 'real').length,
      synthetic: runs.filter(r => r.provenance === 'synthetic').length,
      steps: reports.reduce((n, r) => n + r.steps.length, 0),
      reliableSteps: reports.reduce((n, r) => n + r.reliableSteps, 0),
      realTerminalRuns: reports.filter(r => r.provenance === 'real' && r.terminalLearningEligible).length },
    limitations: ['出现次数不是发牌概率，条件牌池和漏拍会影响覆盖。',
      '槽位变化不是游戏事件归因；同槽替换可能无法从两帧区分。',
      '玩家选择不是最优动作标签；未选择的牌没有真实反事实结果。'] }
}

export type DatasetSplit = 'train' | 'validation' | 'test'
export function splitForRun(runId: string, seed = 'vorax-observational-v1'): DatasetSplit {
  // Stable per run, not per row. Existing assignments do not move when more runs arrive.
  let h = 2166136261
  for (const c of seed + ':' + runId) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const bucket = (h >>> 0) % 100
  return bucket < 70 ? 'train' : bucket < 85 ? 'validation' : 'test'
}
export const featureNames = [
  'round',
  ...Array.from({ length: 6 }, (_, i) => ['occupied', 'logQuantity', 'logUnitActivity',
    ...raceIds.map(r => 'race-' + r), ...rarityIds.map(r => 'rarity-' + r)].map(k => `slot-${i + 1}/${k}`)).flat(),
]
/** Only pre-action visible data. No chosen action, after-state, end score or run-level tags. */
export function stateFeatures(frame: RunFrame): number[] {
  return [frame.state.round, ...frame.state.monsters.flatMap(m => [
    m.race ? 1 : 0, Math.log1p(m.quantity), Math.log1p(m.unitActivity),
    ...raceIds.map(r => m.race === r ? 1 : 0), ...rarityIds.map(r => m.race && m.rarity === r ? 1 : 0),
  ])]
}
export function cohortKey(run: RunArchive, frame: RunFrame): string {
  // Do not mix games/rules, real/synthetic, different offers, passive age, phase or redraw context.
  return JSON.stringify([run.provenance, run.gameVersion, run.rulesVersion, frame.phase, frame.redrawsRemaining,
    frame.passives.map(p => [p.cardId, p.acquiredRound === null ? null : frame.state.round - p.acquiredRound])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    frame.offered.map(c => c.cardId ? 'id:' + c.cardId : 'name:' + c.name).sort()])
}
export interface ValueSample {
  runId: string
  frameId: string
  split: DatasetSplit
  cohort: string
  features: number[]
  finalActivity: number
}
export function buildValueDataset(runs: RunArchive[], seed?: string) {
  const audit = classifyRuns(runs)
  const samples: ValueSample[] = []
  for (const run of runs) {
    if (terminalLearningIssues(run).length) continue
    const seen = new Set<string>()
    for (const s of run.steps) {
      const f = s.before
      if (f.state.round > 10 || !f.offersComplete || !f.offerId || seen.has(f.id)) continue
      seen.add(f.id)
      samples.push({ runId: run.runId, frameId: f.id, split: splitForRun(run.runId, seed),
        cohort: cohortKey(run, f), features: stateFeatures(f), finalActivity: activity(run.end.frame!) })
    }
  }
  return { featureVersion: 'fixed-six-slots-v1', featureNames, samples,
    excluded: audit.runs.filter(r => !r.terminalLearningEligible).map(r => ({ runId: r.runId, reasons: r.terminalIssues })),
    labelMeaning: '已记录玩家策略下的终局活性，不是最优价值、卡牌期望或因果效果。' }
}
