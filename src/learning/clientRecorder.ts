import { candidateCards, persistentCards } from '../data/sampleLibrary'
import type { RecognitionSnapshot, RecognizedValue } from '../recognition/contracts'
import type { ChoiceRecord, ChoiceTrackingState } from '../recognition/choiceTracking'
import { monsterDictionary, resolveMonsterName, type MonsterNameEntry } from '../recognition/monsterDictionary'
import { raceIds, rarityIds, type DecisionMode, type MonsterGroup } from '../types/game'
import { createRun, frameIssues, validateArchive, type RunArchive, type RunFrame, type ObservedAction } from './archive'
import { frameTags } from './dataset'

const cards = [...candidateCards, ...persistentCards]
const normalize = (s: string) => s.normalize('NFKC').replace(/\s/g, '')
const cardByName = (name: string) => cards.find(c => normalize(c.name) === normalize(name))
const good = <T,>(v: RecognizedValue<T> | undefined): v is RecognizedValue<T> => !!v && Number.isFinite(v.confidence) && v.confidence >= .9 && v.confidence <= 1
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max

export interface CaptureEvidence {
  snapshot: RecognitionSnapshot
  source: 'screen' | 'import'
  frame: RunFrame | null
  issues: string[]
  /** UI knowledge, never silently presented as a screen observation. */
  recordedPassiveIds: string[]
}
export type JournalPayload =
  | { type: 'start'; reason: 'first-capture' | 'new-game' | 'round-reset' | 'import'; gameVersion: string; rulesVersion: string }
  | { type: 'capture'; capture: CaptureEvidence }
  | { type: 'choice'; record: ChoiceRecord; beforeCaptureId: string | null; origin: 'listener' | 'manual' }
  | { type: 'gap'; reason: string }
  | { type: 'end'; reason: string }
export type JournalEvent = JournalPayload & { schemaVersion: 1; runId: string; id: string; sequence: number; recordedAt: string }
export interface RecordedRun { runId: string; events: JournalEvent[] }

/** Never accepts merged UI state: that state deliberately retains old fields. */
export function captureEvidence(snapshot: RecognitionSnapshot, id: string, source: CaptureEvidence['source'],
  mode: DecisionMode, passiveIds: string[], entries: readonly MonsterNameEntry[]): CaptureEvidence {
  const issues: string[] = []
  const dictionary = monsterDictionary(entries)
  const monsters: MonsterGroup[] = []
  const confidences: number[] = []
  const slots = snapshot.monsterSlots ?? []
  if (slots.length !== 6 || new Set(slots.map(s => s.slotId)).size !== 6) issues.push('未取得完整且唯一的六槽原始信息')
  for (let n = 1; n <= 6; n++) {
    const original = slots.find(s => s.slotId === `slot-${n}`)
    if (!original || !good(original.occupied) || typeof original.occupied.value !== 'boolean') { issues.push(`槽 ${n} 占用状态不可靠`); continue }
    const s = resolveMonsterName(original, dictionary).slot
    confidences.push(s.occupied.confidence)
    if (!s.occupied.value) {
      // A confident empty slot clears the old occupant; it is not a missing slot.
      monsters.push({ id: s.slotId, race: null, rarity: 'common', quantity: 0, unitActivity: 0 }); continue
    }
    if (!good(s.raceId) || !raceIds.includes(s.raceId.value) || !good(s.rarity) || !rarityIds.includes(s.rarity.value)
      || !good(s.quantity) || !integer(s.quantity.value, 1) || !good(s.unitActivity) || !integer(s.unitActivity.value, 1)) {
      issues.push(`槽 ${n} 种群、稀有度或数值待核对`); continue
    }
    confidences.push(s.raceId.confidence, s.rarity.confidence, s.quantity.confidence, s.unitActivity.confidence)
    if (good(s.displayedTotalActivity) && s.displayedTotalActivity.value !== s.quantity.value * s.unitActivity.value) issues.push(`槽 ${n} 活性乘积不符`)
    monsters.push({ id: s.slotId, race: s.raceId.value, rarity: s.rarity.value, quantity: s.quantity.value, unitActivity: s.unitActivity.value })
  }
  if (!good(snapshot.round) || !integer(snapshot.round.value, 1, 13)) issues.push('轮次不可靠')
  const phase: RunFrame['phase'] = !good(snapshot.phase) ? 'unknown'
    : snapshot.phase.value === 'surgeryRewardSelection' ? 'permanent'
      : snapshot.phase.value === 'potionSelection' ? 'potion'
        : snapshot.phase.value === 'expandedPotionSelection' ? 'expanded'
          : snapshot.phase.value === 'surgeryPlanSelection' ? 'surgery' : 'unknown'
  const names = snapshot.candidateCardNames ?? []
  const offered = names.slice(0, 5).filter(n => typeof n.value === 'string' && n.value.trim()).map(n => ({ name: n.value, cardId: cardByName(n.value)?.id ?? null }))
  let frame: RunFrame | null = null
  if (monsters.length === 6 && good(snapshot.round) && integer(snapshot.round.value, 1, 13)) {
    frame = { id, evidence: `journal:${id}`, state: { round: snapshot.round.value, mode, monsters, recognitionReview: [...issues] }, phase,
      confidence: Math.min(...confidences, snapshot.round.confidence, good(snapshot.phase) ? snapshot.phase.confidence : 0),
      displayedActivity: good(snapshot.displayedFinalActivity) && integer(snapshot.displayedFinalActivity.value) ? snapshot.displayedFinalActivity.value : null,
      offerId: id, offersComplete: [3, 5].includes(names.length) && names.every(good) && offered.length === names.length,
      offered, passives: [...new Set(passiveIds.filter(p => p !== 'none'))].map(cardId => ({ cardId, acquiredRound: null })),
      redrawsRemaining: good(snapshot.rerollsRemaining) && integer(snapshot.rerollsRemaining.value, 0, 3) ? snapshot.rerollsRemaining.value : null }
    try {
      validateArchive({ ...createRun({ runId: id, provenance: 'real', gameVersion: 'unknown', rulesVersion: 'client-recorder-v1' }),
        steps: [{ id, before: frame, after: null, singleActionConfirmed: false, action: unknownAction() }] })
      issues.push(...frameIssues(frame).filter(i => !issues.includes(i)))
    } catch { frame = null; issues.push('画面结构或数值不满足档案协议，保留原始识别结果') }
  }
  return structuredClone({ snapshot, source, frame, issues, recordedPassiveIds: passiveIds })
}

const unknownAction = (): ObservedAction => ({ type: 'unknown', cardId: null, cardName: null, confirmation: 'unknown',
  targetMode: 'unknown', selectedSlotIds: [], observedRandomSlotIds: [], targetsConfirmed: false })

export function validateJournal(run: RecordedRun): void {
  if (!run || !/^[a-zA-Z0-9-]{1,80}$/.test(run.runId) || !Array.isArray(run.events)) throw new Error('牌局记录格式错误')
  const ids = new Set<string>()
  run.events.forEach((e, i) => {
    if (!e || e.schemaVersion !== 1 || e.runId !== run.runId || !/^[a-zA-Z0-9-]{1,80}$/.test(e.id) || ids.has(e.id)
      || e.sequence !== i + 1 || !Number.isFinite(Date.parse(e.recordedAt))
      || !['start', 'capture', 'choice', 'gap', 'end'].includes(e.type)) throw new Error('牌局事件缺失、重复或格式错误；原文件未改动')
    ids.add(e.id)
    if (i === 0 && e.type !== 'start') throw new Error('缺少开局事件')
    if (e.type === 'capture') {
      if (!e.capture || !e.capture.snapshot || !Array.isArray(e.capture.issues) || !Array.isArray(e.capture.recordedPassiveIds)) throw new Error('识别证据格式错误')
      if (e.capture.frame !== null) validateArchive({ ...createRun({ runId: run.runId, provenance: 'real', gameVersion: 'unknown', rulesVersion: 'client-recorder-v1' }),
        steps: [{ id: e.id, before: e.capture.frame, after: null, singleActionConfirmed: false, action: unknownAction() }] })
    }
    if (e.type === 'choice' && (!e.record || typeof e.record.name !== 'string' || !Array.isArray(e.record.targetSlots))) throw new Error('选牌证据格式错误')
  })
}

export function summarizeRun(run: RecordedRun) {
  const captures = run.events.filter((e): e is JournalEvent & { type: 'capture' } => e.type === 'capture')
  const choices = new Map(run.events.filter(e => e.type === 'choice').map(e => [e.record.id, e]))
  const tags = [...new Set(captures.flatMap(e => e.capture.frame && !e.capture.issues.length ? frameTags(e.capture.frame) : []))]
  return { captures: captures.length, reliable: captures.filter(e => e.capture.frame && !e.capture.issues.length).length,
    choices: [...choices.values()].filter(e => e.record.status !== 'ignored').length,
    gaps: run.events.filter(e => e.type === 'gap').length, tags, closed: run.events.at(-1)?.type === 'end' }
}

/** Observation-only export. No click evidence is promoted to a one-action guarantee. */
export function journalArchive(run: RecordedRun): RunArchive {
  validateJournal(run)
  const start = run.events[0]
  const archive = createRun({ runId: run.runId, provenance: 'real', gameVersion: start?.type === 'start' ? start.gameVersion : 'unknown', rulesVersion: 'client-recorder-v1' })
  let before: RunFrame | null = null
  let beforeId: string | null = null
  const choices = new Map(run.events.filter(e => e.type === 'choice').map(e => [e.record.id, e]))
  for (const e of run.events) {
    if (e.type !== 'capture') continue
    const frame = e.capture.frame
    if (before) {
      const linked = [...choices.values()].filter(c => c.beforeCaptureId === beforeId && ['manual', 'transition-observed'].includes(c.record.status))
      let action = unknownAction()
      if (linked.length === 1) {
        const record = linked[0].record, card = cardByName(record.name)
        const targeting = card && 'targeting' in card ? card.targeting : undefined
        action = { type: record.phase === 'surgeryRewardSelection' ? 'acquirePermanent' : 'play', cardId: card?.id ?? null,
          cardName: record.name, confirmation: record.status === 'manual' ? 'manual' : 'click-observed',
          targetMode: targeting?.mode === 'choose' ? 'choose' : targeting?.mode === 'observedRandom' ? 'random' : 'unknown',
          selectedSlotIds: targeting?.mode === 'choose' ? [...new Set(record.targetSlots)].filter(n => integer(n, 1, 6)).map(n => `slot-${n}`) : [],
          observedRandomSlotIds: [], targetsConfirmed: false }
      }
      archive.steps.push({ id: `step-${e.id}`, before, after: frame, action, singleActionConfirmed: false })
    }
    // A failed capture breaks continuity, not a license to skip to the next good one.
    before = frame; beforeId = e.id
  }
  if (before) archive.steps.push({ id: `tail-${beforeId}`, before, after: null, action: unknownAction(), singleActionConfirmed: false })
  validateArchive(archive)
  return archive
}

export class ClientRecorder {
  run: RecordedRun | null = null
  enabled = true
  error = ''
  pending: JournalEvent[] = []
  private writing = false
  private seen = new Map<string, string>()
  private bindings = new Map<string, string | null>()
  private choicesInitialized = false
  private latest: (JournalEvent & { type: 'capture' }) | null = null
  private signatures = new Set<string>()
  private lastRound: number | null = null
  private subscribers = new Set<() => void>()
  constructor(private write: (event: JournalEvent) => Promise<void>, private uuid: () => string = () => crypto.randomUUID(), private now = () => new Date().toISOString()) {}
  subscribe = (fn: () => void) => { this.subscribers.add(fn); return () => { this.subscribers.delete(fn) } }
  private notify() { for (const fn of this.subscribers) fn() }
  private append(payload: JournalPayload, id = this.uuid()) {
    if (!this.run) return
    const event = structuredClone({ ...payload, schemaVersion: 1 as const, runId: this.run.runId, id, sequence: this.run.events.length + 1, recordedAt: this.now() })
    this.run = { ...this.run, events: [...this.run.events, event] }; this.pending.push(event); this.notify(); void this.flush()
    return event
  }
  async flush() {
    if (this.writing || this.error) return
    this.writing = true
    try {
      while (this.pending.length) { await this.write(this.pending[0]); this.pending.shift(); this.notify() }
    } catch (error) { this.error = `自动记录保存失败：${String(error)}。未保存事件仍在内存，请重试或导出后再关闭。`; this.notify() }
    finally { this.writing = false }
  }
  retry() { this.error = ''; this.notify(); void this.flush() }
  start(reason: Extract<JournalPayload, { type: 'start' }>['reason'] = 'new-game') {
    if (this.run && this.run.events.at(-1)?.type !== 'end') this.append({ type: 'end', reason: '开始另一局；上一局未确认终局' })
    this.run = { runId: this.uuid(), events: [] }; this.latest = null; this.lastRound = null; this.bindings.clear(); this.signatures.clear()
    this.append({ type: 'start', reason, gameVersion: 'unknown', rulesVersion: 'client-recorder-v1' })
  }
  end() { if (this.run && this.run.events.at(-1)?.type !== 'end') this.append({ type: 'end', reason: '用户结束记录；未确认最终结算' }); this.latest = null }
  gap(reason: string) {
    if (this.enabled && this.run && this.run.events.at(-1)?.type !== 'end') this.append({ type: 'gap', reason })
    this.latest = null
  }
  toggle() {
    if (this.enabled) this.gap('用户暂停记录，后续操作可能漏记')
    this.enabled = !this.enabled
    if (this.enabled) this.gap('恢复记录；不连接暂停前后的动作')
    this.latest = null; this.notify()
  }
  capture(snapshot: RecognitionSnapshot, source: CaptureEvidence['source'], mode: DecisionMode, passiveIds: string[], entries: readonly MonsterNameEntry[]) {
    if (!this.enabled) return
    const signature = JSON.stringify([source, snapshot])
    if (this.signatures.has(signature)) return
    // Imported historical screenshots must never contaminate a live run.
    if (source === 'import') this.start('import')
    else if (!this.run || this.run.events.at(-1)?.type === 'end') this.start('first-capture')
    else if (good(snapshot.round) && this.lastRound !== null && snapshot.round.value < this.lastRound) this.start('round-reset')
    this.signatures.add(signature)
    const id = this.uuid()
    const capture = captureEvidence(snapshot, id, source, mode, passiveIds, entries)
    if (capture.frame) {
      const start = this.run!.events[0]
      const initial = this.run!.events.find(e => e.type === 'capture')
      const baseline = start.type === 'start' && ['new-game', 'round-reset'].includes(start.reason) ? []
        : initial?.type === 'capture' ? initial.capture.frame?.passives ?? [] : capture.frame.passives
      const passives = new Map(baseline.map(p => [p.cardId, p]))
      const actual = new Map(this.run!.events.filter(e => e.type === 'choice').map(e => [e.record.id, e]))
      for (const choice of actual.values()) {
        if (!choice.beforeCaptureId || choice.record.phase !== 'surgeryRewardSelection'
          || !['manual', 'transition-observed'].includes(choice.record.status) || choice.record.round > capture.frame.state.round) continue
        const card = persistentCards.find(c => normalize(c.name) === normalize(choice.record.name))
        if (card && card.id !== 'none') passives.set(card.id, { cardId: card.id, acquiredRound: choice.record.round })
      }
      capture.frame.passives = [...passives.values()]
    }
    const old = this.latest?.capture.frame
    const hasChoice = this.run!.events.some(e => e.type === 'choice' && e.beforeCaptureId === this.latest?.id && ['manual', 'transition-observed'].includes(e.record.status))
    if (capture.frame && old && !hasChoice && capture.frame.state.round === old.state.round && capture.frame.phase === old.phase
      && JSON.stringify(capture.frame.offered) === JSON.stringify(old.offered)) capture.frame.offerId = old.offerId
    if (good(snapshot.round) && integer(snapshot.round.value, 1, 13)) this.lastRound = snapshot.round.value
    const event = this.append({ type: 'capture', capture }, id)
    this.latest = event?.type === 'capture' ? event : null
    if (source === 'import') this.end()
  }
  choices(tracking: ChoiceTrackingState | null | undefined) {
    if (!tracking) return
    const records = [...tracking.records, ...(tracking.pending ? [tracking.pending] : [])]
    // First service poll may contain an entire old game. Establish a baseline only.
    if (!this.choicesInitialized) { records.forEach(r => this.seen.set(r.id, JSON.stringify(r))); this.choicesInitialized = true; return }
    for (const record of records) {
      const raw = JSON.stringify(record)
      if (this.seen.get(record.id) === raw) continue
      const knownBefore = this.seen.has(record.id)
      this.seen.set(record.id, raw)
      if (!this.enabled || !this.latest || !this.run || this.run.events.at(-1)?.type === 'end') continue
      // Old baseline IDs are not rebound to this run when their status changes.
      if (knownBefore && !this.bindings.has(record.id)) continue
      this.recordChoice(record, 'listener')
    }
  }
  recordChoice(record: ChoiceRecord, origin: 'listener' | 'manual' = 'manual') {
    if (!this.enabled || !this.run || this.run.events.at(-1)?.type === 'end') return
    if (!this.bindings.has(record.id)) {
      const s = this.latest?.capture.snapshot
      const name = s?.candidateCardNames?.[record.cardIndex]
      const historicalManual = origin === 'manual' && this.seen.has(record.id)
      this.bindings.set(record.id, !historicalManual && s && good(s.round) && s.round.value === record.round && good(s.phase) && s.phase.value === record.phase
        && good(name) && normalize(name.value) === normalize(record.name) ? this.latest!.id : null)
    }
    this.append({ type: 'choice', record, beforeCaptureId: this.bindings.get(record.id) ?? null, origin })
  }
}
