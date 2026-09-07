import { describe, expect, it } from 'vitest'
import { captureEvidence, ClientRecorder, journalArchive, summarizeRun, validateJournal, type JournalEvent } from './clientRecorder'
import type { RecognitionSnapshot } from '../recognition/contracts'
import type { ChoiceRecord, ChoiceTrackingState } from '../recognition/choiceTracking'
import { buildValueDataset, classifyRuns } from './dataset'
const v = <T,>(value: T) => ({ value, confidence: 1 })
const shot = (round = 1, at = '2026-09-07T01:00:00Z'): RecognitionSnapshot => ({ capturedAt: at, round: v(round), phase: v('surgeryRewardSelection'),
  displayedFinalActivity: v(360), candidateCardIds: [], candidateCardNames: ['肿大脑垂体', '孽生肉芽', '未知卡片'].map(v),
  monsterSlots: Array.from({ length: 6 }, (_, i) => i === 2 ? { slotId: 'slot-3', occupied: v(true), name: v('蝎兽'), quantity: v(36), unitActivity: v(10) }
    : { slotId: `slot-${i + 1}`, occupied: v(false) }) })
const choice = (status: ChoiceRecord['status'] = 'selected'): ChoiceRecord => ({ id: 'choice-1', round: 1, phase: 'surgeryRewardSelection', cardIndex: 0, name: '肿大脑垂体', status, targetSlots: [] })
const tracking = (records: ChoiceRecord[] = [], pending: ChoiceRecord | null = null): ChoiceTrackingState => ({ enabled: true, hookActive: true, message: '', records, pending })
function harness(write?: (e: JournalEvent) => Promise<void>) {
  let id = 0
  const persisted: JournalEvent[] = []
  const recorder = new ClientRecorder(write ?? (async e => { persisted.push(e) }), () => `id-${++id}`, () => '2026-09-07T01:00:00Z')
  return { recorder, persisted, capture: (s = shot()) => recorder.capture(s, 'screen', 'strategic', [], []) }
}
describe('client natural-run recorder', () => {
  it('does not record example UI state at startup', () => { const { recorder, persisted } = harness(); expect(recorder.run).toBeNull(); expect(persisted).toEqual([]) })
  it('uses exact names and reliable empty slots without old UI state', () => {
    const result = captureEvidence(shot(), 'frame', 'screen', 'activity', [], [])
    expect(result.issues).toEqual([])
    expect(result.frame!.state.monsters[2]).toMatchObject({ race: 'aberrant', rarity: 'common', quantity: 36 })
    expect(result.frame!.state.monsters[0]).toMatchObject({ race: null, quantity: 0, unitActivity: 0 })
    expect(result.frame!.offered[2]).toEqual({ name: '未知卡片', cardId: null })
  })
  it('preserves incomplete OCR and never pads missing slots', () => {
    const s = shot(); s.monsterSlots!.pop()
    const result = captureEvidence(s, 'frame', 'screen', 'activity', [], [])
    expect(result.frame).toBeNull(); expect(result.snapshot.monsterSlots).toHaveLength(5); expect(result.issues.length).toBeGreaterThan(0)
  })
  it('marks total mismatch and unknown phase instead of discarding evidence', () => {
    const s = shot(); s.displayedFinalActivity = v(999); s.phase = v('unknown')
    const r = captureEvidence(s, 'frame', 'screen', 'activity', [], [])
    expect(r.frame).not.toBeNull(); expect(r.issues).toContain('总活性校验不符'); expect(r.issues).toContain('未知阶段')
  })
  it('keeps low-confidence name as raw evidence, not a reliable dictionary hit', () => {
    const s = shot(); s.monsterSlots![2].name!.confidence = .86
    expect(captureEvidence(s, 'frame', 'screen', 'activity', [], []).frame).toBeNull()
  })
  it('deduplicates the same service snapshot and leaves input immutable', async () => {
    const { recorder, capture } = harness(), s = shot(), before = JSON.stringify(s)
    capture(s); capture(s); await recorder.flush()
    expect(summarizeRun(recorder.run!).captures).toBe(1); expect(JSON.stringify(s)).toBe(before)
    const e = recorder.run!.events.find(e => e.type === 'capture')!
    if (e.type === 'capture') expect(e.capture.frame?.id).toBe(e.id)
  })
  it('does not count an unchanged second screenshot as a new offer', () => {
    const { recorder, capture } = harness(); capture(); capture(shot(1, 'later'))
    expect(summarizeRun(recorder.run!).captures).toBe(2)
    expect(classifyRuns([journalArchive(recorder.run!)]).runs[0].observedOffers).toBe(1)
  })
  it('ignores old service history and deduplicates status polling', () => {
    const { recorder, capture } = harness(); recorder.choices(tracking([choice('transition-observed')])); capture()
    recorder.choices(tracking([choice('transition-observed')])); recorder.choices(tracking([choice('manual')]))
    expect(summarizeRun(recorder.run!).choices).toBe(0)
  })
  it('links a new click to pre-state and preserves passive acquisition across one poll', () => {
    const { recorder, capture } = harness(); recorder.choices(tracking()); capture()
    recorder.choices(tracking([], choice())); recorder.choices(tracking([], choice()))
    recorder.choices(tracking([choice('transition-observed')]))
    const next = shot(2); next.phase = v('potionSelection'); capture(next)
    expect(summarizeRun(recorder.run!).choices).toBe(1)
    const archive = journalArchive(recorder.run!)
    expect(archive.steps[0].action).toMatchObject({ type: 'acquirePermanent', confirmation: 'click-observed' })
    expect(archive.steps[0].after!.passives).toContainEqual({ cardId: 'hypertrophic-pituitary', acquiredRound: 1 })
    expect(buildValueDataset([archive]).samples).toHaveLength(0)
  })
  it('does not match the same name in a different phase or slot', () => {
    const { recorder, capture } = harness(); capture(); recorder.recordChoice({ ...choice('manual'), cardIndex: 2 })
    const e = recorder.run!.events.at(-1)!
    expect(e.type === 'choice' && e.beforeCaptureId).toBeNull()
  })
  it('does not attach a manual correction of old service history to an identical new offer', () => {
    const { recorder, capture } = harness(); recorder.choices(tracking([choice('uncertain')])); capture()
    recorder.recordChoice(choice('manual'))
    const e = recorder.run!.events.at(-1)!
    expect(e.type === 'choice' && e.beforeCaptureId).toBeNull()
  })
  it('preserves later manual confirmation and ignored corrections in raw journal', () => {
    const { recorder, capture } = harness(); capture(); recorder.recordChoice(choice('uncertain')); capture(shot(2))
    recorder.recordChoice(choice('manual')); expect(journalArchive(recorder.run!).steps[0].action.confirmation).toBe('manual')
    recorder.recordChoice(choice('ignored')); expect(journalArchive(recorder.run!).steps[0].action.type).toBe('unknown')
    expect(recorder.run!.events.filter(e => e.type === 'choice')).toHaveLength(3)
  })
  it('separates explicit new games, automatic round regression and imported screenshots', () => {
    const { recorder, capture } = harness(); capture(shot(7)); const old = recorder.run!.runId
    capture(shot(1)); expect(recorder.run!.runId).not.toBe(old); expect(recorder.run!.events[0]).toMatchObject({ reason: 'round-reset' })
    const live = recorder.run!.runId; recorder.capture(shot(), 'import', 'activity', [], [])
    expect(recorder.run!.runId).not.toBe(live); expect(recorder.run!.events[0]).toMatchObject({ reason: 'import' }); expect(summarizeRun(recorder.run!).closed).toBe(true)
    recorder.start(); expect(recorder.run!.events).toHaveLength(1)
  })
  it('marks pauses and ignores all captures/choices while paused', () => {
    const { recorder, capture } = harness(); capture(); recorder.toggle(); capture(shot(2)); recorder.recordChoice(choice('manual'))
    expect(summarizeRun(recorder.run!).captures).toBe(1); expect(summarizeRun(recorder.run!).choices).toBe(0)
    recorder.toggle(); capture(shot(3)); expect(summarizeRun(recorder.run!).gaps).toBe(2)
    expect(journalArchive(recorder.run!).steps.every(s => !s.singleActionConfirmed)).toBe(true)
  })
  it('breaks the export chain at incomplete captures', () => {
    const { recorder, capture } = harness(); capture(); const bad = shot(2); bad.monsterSlots = []; capture(bad); capture(shot(3))
    const archive = journalArchive(recorder.run!)
    expect(archive.steps[0].after).toBeNull(); expect(archive.steps[1].before.state.round).toBe(3)
  })
  it('never treats end-recording as terminal reward', () => {
    const { recorder, capture } = harness(); capture(shot(13)); recorder.end()
    const archive = journalArchive(recorder.run!); expect(archive.end).toEqual({ kind: 'incomplete', frame: null }); expect(buildValueDataset([archive]).samples).toHaveLength(0)
  })
  it('retains failed writes and retries the same immutable event IDs', async () => {
    let fail = true; const ids: string[] = []
    const { recorder, capture } = harness(async e => { if (fail) throw new Error('disk full'); ids.push(e.id) })
    capture(); await new Promise(resolve => setTimeout(resolve, 0))
    expect(recorder.error).toContain('disk full'); expect(recorder.pending).toHaveLength(2)
    const expected = recorder.pending.map(e => e.id); fail = false; recorder.retry()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ids).toEqual(expected); expect(recorder.pending).toEqual([])
  })
  it('rejects corrupt sequences and invalid saved frames', () => {
    const { recorder, capture } = harness(); capture(); const corrupt = structuredClone(recorder.run!)
    corrupt.events[1].sequence = 9; expect(() => validateJournal(corrupt)).toThrow('缺失')
  })
})
