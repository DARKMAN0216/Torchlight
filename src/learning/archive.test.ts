import { describe, expect, it } from 'vitest'
import { activity, appendStep, createRun, finishRun, frameIssues, parseArchives, serializeArchives,
  stepIssues, terminalLearningIssues, validateArchive } from './archive'
import { buildValueDataset, classifyRuns, observedChanges, splitForRun, stateFeatures } from './dataset'
import { importHistoricalRun, replayHistoricalChecks, syntheticTrainingRuns } from './verification'

const complete = () => syntheticTrainingRuns(1)[0]
const partial = () => ({ ...complete(), end: { kind: 'incomplete' as const, frame: null } })

describe('natural-run recording and evidence integrity', () => {
  it('imports historical observations as one incomplete game, not 11 terminal games', () => {
    const real = importHistoricalRun(), report = classifyRuns([real])
    expect(real.steps).toHaveLength(11)
    expect(report.totals).toMatchObject({ runs: 1, real: 1, steps: 11, realTerminalRuns: 0 })
    expect(report.runs[0]).toMatchObject({ terminalActivity: null, lastObservedActivity: 463722 })
    expect(buildValueDataset([real]).samples).toHaveLength(0)
  })
  it('preserves unknown card names without requiring their simulator rules', () => {
    const run = partial(), step = run.steps[0]
    step.before.offered[0] = { name: '未建模真实卡', cardId: null }
    step.action.cardId = null; step.action.cardName = '未建模真实卡'
    validateArchive(run)
    expect(stepIssues(step)).toEqual([])
    expect(classifyRuns([run]).runs[0].offeredCounts['name:未建模真实卡']).toBe(1)
  })
  it('appends immutably and makes retrying the same step idempotent', () => {
    const base = createRun({ runId: 'one', provenance: 'real', gameVersion: 'v1', rulesVersion: 'r1' })
    const step = complete().steps[0], next = appendStep(base, step)
    expect(base.steps).toEqual([])
    expect(appendStep(next, step).steps).toHaveLength(1)
    expect(() => appendStep(next, { ...step, singleActionConfirmed: false })).toThrow('冲突')
  })
  it('round trips evidence through JSONL with BOM, rejects duplicate runs', () => {
    const run = complete()
    expect(parseArchives('\uFEFF' + serializeArchives([run]))).toEqual([run])
    expect(() => serializeArchives([run, run])).toThrow('重复 runId')
    expect(() => parseArchives('{')).toThrow('JSONL第1条')
  })
  it('rejects conflicting observation IDs instead of overwriting evidence', () => {
    const run = partial()
    run.steps[1].before = structuredClone(run.steps[1].before)
    run.steps[1].before.displayedActivity = 999
    expect(() => validateArchive(run)).toThrow('画面 ID 内容冲突')
  })
  it('rejects conflicting complete offer IDs, including same names in different order', () => {
    const run = partial()
    run.steps[0].before.offerId = run.steps[1].before.offerId
    expect(() => validateArchive(run)).toThrow('发牌 ID 内容冲突')
  })
  it('does not infer terminal score from an abandoned or last observed state', () => {
    const run = partial()
    const abandoned = finishRun(run, { kind: 'abandoned', frame: run.steps[12].after })
    expect(classifyRuns([abandoned]).runs[0].terminalActivity).toBeNull()
    expect(buildValueDataset([abandoned]).samples).toEqual([])
  })
  it('requires a reliable post-round-13 frame to confirm completion', () => {
    const run = partial()
    expect(() => finishRun(run, { kind: 'confirmed-terminal', frame: run.steps[9].after })).toThrow('终局')
    const bad = structuredClone(run.steps[12].after!)
    bad.displayedActivity = 1000000
    bad.id = 'terminal-bad'
    expect(() => finishRun(run, { kind: 'confirmed-terminal', frame: bad })).toThrow('终局')
    expect(() => appendStep(complete(), run.steps[0])).toThrow('已关闭')
  })
  it.each(['confidence', 'displayedActivity', 'recognitionReview'] as const)('retains but excludes unreliable %s', key => {
    const run = partial()
    if (key === 'confidence') run.steps[0].before.confidence = .5
    if (key === 'displayedActivity') run.steps[0].before.displayedActivity = null
    if (key === 'recognitionReview') run.steps[0].before.state.recognitionReview = ['槽3未确认']
    validateArchive(run)
    expect(frameIssues(run.steps[0].before).length).toBeGreaterThan(0)
    expect(classifyRuns([run]).runs[0].steps[0].observationPairUsable).toBe(false)
  })
  it('rejects invalid fixed slots, unsafe arithmetic and malformed actions', () => {
    const missing = partial(); missing.steps[0].before.state.monsters.pop()
    expect(() => validateArchive(missing)).toThrow('六槽')
    const huge = partial(); huge.steps[0].before.state.monsters[0].quantity = Number.MAX_SAFE_INTEGER
    expect(() => validateArchive(huge)).toThrow('安全整数')
    const invalid = partial(); invalid.steps[0].action.selectedSlotIds = ['slot-7']
    expect(() => validateArchive(invalid)).toThrow('动作')
  })
  it('keeps chosen targets and observed random outcomes separate', () => {
    const real = importHistoricalRun(), action = real.steps[0].action
    expect(action.targetMode).toBe('random')
    expect(action.selectedSlotIds).toEqual([])
    expect(action.observedRandomSlotIds).toEqual(['slot-4'])
    action.selectedSlotIds = ['slot-4']
    expect(() => validateArchive(real)).toThrow('随机落点')
  })
  it('does not promote click evidence alone into a confirmed learning action', () => {
    const run = complete()
    run.steps[0].action.confirmation = 'click-observed'
    expect(terminalLearningIssues(run)).toContain('存在未确认/不完整步骤')
    expect(buildValueDataset([run]).samples).toHaveLength(0)
  })
  it('retains missing outcomes and skipped operations but excludes them', () => {
    const run = partial()
    run.steps[0].after = null
    run.steps[1].singleActionConfirmed = false
    const report = classifyRuns([run]).runs[0]
    expect(report.steps[0].issues).toContain('缺少操作后画面')
    expect(report.steps[1].issues).toContain('不能确认两帧间只有一次操作')
  })
  it('requires occupied confirmed selectable targets and visible selected card', () => {
    const s = partial().steps[0]
    s.action.targetMode = 'choose'; s.action.selectedSlotIds = ['slot-6']
    s.action.cardId = 'not-offered'
    expect(stepIssues(s)).toContain('可选目标为空或不存在')
    expect(stepIssues(s)).toContain('选择不在完整候选中')
  })
  it('checks redraws in the same round without accepting board changes', () => {
    const s = structuredClone(partial().steps[0])
    s.action.type = 'redraw'; s.action.cardId = null; s.action.cardName = null
    s.before.redrawsRemaining = 3
    s.after = structuredClone(s.before)
    s.after.id = 'after-redraw'; s.after.offerId = 'offer-redraw'; s.after.redrawsRemaining = 2
    expect(stepIssues(s)).toEqual([])
    s.after.state.round++
    expect(stepIssues(s)).toContain('洗牌边界或次数不符')
  })
  it('does not turn early permanent selection into a surgery-plan advance', () => {
    const step = partial().steps[0]
    step.action.type = 'advanceSurgery'
    expect(stepIssues(step)).toContain('手术推进阶段不符')
    step.action.type = 'acquirePermanent'
    expect(stepIssues(step)).toContain('常驻选择阶段不符')
    step.before.phase = 'permanent'
    expect(stepIssues(step)).toEqual([])
  })
  it('rejects phantom targets on targetless actions', () => {
    const step = partial().steps[0]
    step.action.selectedSlotIds = ['slot-1']
    expect(stepIssues(step)).toContain('无目标操作含有可选目标')
  })
})

describe('classification and training leakage gates', () => {
  it('counts every offered card, not only the chosen card; deduplicates an observed offer', () => {
    const real = importHistoricalRun(), audit = classifyRuns([real]).runs[0]
    expect(audit.observedOffers).toBe(11)
    expect(Object.values(audit.offeredCounts).reduce((a, b) => a + b, 0)).toBe(35)
    expect(Object.values(audit.chosenCounts).reduce((a, b) => a + b, 0)).toBe(11)
  })
  it('classifies pupa without swarm by that observed frame, not the final board', () => {
    const run = partial(), frame = run.steps[0].before
    frame.passives = [{ cardId: 'human-pupa', acquiredRound: 0 }]
    frame.state.monsters[0].race = 'awakened'
    expect(classifyRuns([run]).runs[0].tags).toContain('route:pupa-without-swarm')
  })
  it('reports visible slot changes without claiming internal event counts', () => {
    const before = partial().steps[0].before, after = structuredClone(before)
    after.state.monsters[0] = { id: 'slot-1', race: null, rarity: 'common', quantity: 0, unitActivity: 0 }
    expect(observedChanges(before, after)).toEqual(['observed:slot-emptied'])
    expect(observedChanges(before, structuredClone(before))).toEqual([])
  })
  it('keeps a complete run in a single stable split when other runs are added', () => {
    const runs = syntheticTrainingRuns(12), first = buildValueDataset(runs.slice(0, 5)).samples
    const later = buildValueDataset(runs).samples
    for (const s of first) expect(later.find(t => t.runId === s.runId && t.frameId === s.frameId)?.split).toBe(s.split)
    for (const run of runs) expect(new Set(later.filter(s => s.runId === run.runId).map(s => s.split)).size).toBe(1)
    expect(splitForRun(runs[0].runId)).toBe(splitForRun(runs[0].runId))
  })
  it('does not include post-action or terminal labels in input features', () => {
    const run = complete(), before = structuredClone(run.steps[0].before)
    const features = stateFeatures(before)
    run.steps[0].after!.state.monsters[0].quantity = 99999
    run.steps[0].action.cardName = 'changed-future-choice'
    run.end.frame!.displayedActivity = 999999
    expect(stateFeatures(before)).toEqual(features)
  })
  it('rejects full-game training on unknown passive ages or discontinuous frames', () => {
    const run = complete()
    run.steps[0].before.passives = [{ cardId: 'human-pupa', acquiredRound: null }]
    expect(terminalLearningIssues(run)).toContain('常驻获得回合未知')
    const gap = complete(); gap.steps.splice(3, 1)
    expect(buildValueDataset([gap]).samples).toHaveLength(0)
    expect(terminalLearningIssues(gap)).toContain('相邻步骤没有连续画面证据')
  })
  it('keeps synthetic and real counts separately and never gives partial runs terminal labels', () => {
    const report = classifyRuns([importHistoricalRun(), ...syntheticTrainingRuns(2)])
    expect(report.totals).toMatchObject({ real: 1, synthetic: 2, realTerminalRuns: 0 })
    expect(buildValueDataset([importHistoricalRun(), ...syntheticTrainingRuns(2)]).samples).toHaveLength(20)
  })
  it('replays only verified historical transitions and exposes the unvalidated remainder', () => {
    const replay = replayHistoricalChecks()
    expect(replay.filter(r => r.status === 'matched').map(r => r.actualActivity)).toEqual([68328, 331980, 463722])
    expect(replay.filter(r => r.status === 'not-validated')).toHaveLength(8)
  })
  it('learns terminal labels in real activity units without rarity or reward multipliers', () => {
    const run = complete(), data = buildValueDataset([run])
    expect(data.samples[0].finalActivity).toBe(activity(run.end.frame!))
    expect(data.samples).toHaveLength(10)
    expect(data.samples[0].features[0]).toBe(1)
  })
})
