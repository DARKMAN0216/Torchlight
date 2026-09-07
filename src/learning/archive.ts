import { raceIds, rarityIds, type GameState } from '../types/game'

/** Observations, not predictions. Unknown mechanics do not prevent archiving. */
export interface RunFrame {
  id: string
  evidence: string
  state: GameState
  phase: 'potion' | 'permanent' | 'expanded' | 'surgery' | 'terminal' | 'unknown'
  confidence: number
  displayedActivity: number | null
  offerId: string | null
  offersComplete: boolean
  offered: { name: string; cardId: string | null }[]
  passives: { cardId: string; acquiredRound: number | null }[]
  redrawsRemaining: number | null
}
export interface ObservedAction {
  type: 'play' | 'acquirePermanent' | 'redraw' | 'advanceSurgery' | 'unknown'
  cardId: string | null
  cardName: string | null
  confirmation: 'manual' | 'click-observed' | 'unknown'
  targetMode: 'choose' | 'random' | 'none' | 'unknown'
  selectedSlotIds: string[]
  observedRandomSlotIds: string[]
  targetsConfirmed: boolean
}
export interface RunStep {
  id: string
  before: RunFrame
  action: ObservedAction
  after: RunFrame | null
  /** Explicit evidence that no unrecorded action occurred between these frames. */
  singleActionConfirmed: boolean
}
export interface RunArchive {
  schemaVersion: 1
  runId: string
  provenance: 'real' | 'synthetic'
  gameVersion: string
  rulesVersion: string
  steps: RunStep[]
  end: { kind: 'incomplete' | 'abandoned' | 'confirmed-terminal'; frame: RunFrame | null }
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max
const oneOf = (v: unknown, options: readonly unknown[]) => options.includes(v)
const optionalId = (v: unknown) => v === null || text(v)
function assert(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason) }
function slots(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 6 && new Set(v).size === v.length && v.every(id => /^slot-[1-6]$/.test(id))
}
function validateFrame(v: unknown): asserts v is RunFrame {
  assert(record(v) && text(v.id) && text(v.evidence), '画面缺少 ID 或来源证据')
  assert(oneOf(v.phase, ['potion', 'permanent', 'expanded', 'surgery', 'terminal', 'unknown']), '阶段无效')
  assert(typeof v.confidence === 'number' && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1, '置信度无效')
  assert(v.displayedActivity === null || integer(v.displayedActivity, 0), '显示总活性无效')
  assert(v.redrawsRemaining === null || integer(v.redrawsRemaining, 0), '洗牌余量无效')
  assert(record(v.state) && integer(v.state.round, 1, 14) && oneOf(v.state.mode, ['activity', 'preserve', 'strategic']), '局面轮次/模式无效')
  const round = v.state.round
  const monsters = v.state.monsters
  assert(Array.isArray(monsters) && monsters.length === 6, '必须记录固定六槽，缺失槽不能推断为空')
  monsters.forEach((m, i) => {
    assert(record(m) && m.id === `slot-${i + 1}` && oneOf(m.race, [null, ...raceIds]) && oneOf(m.rarity, rarityIds), '槽位/种群/稀有度无效')
    assert(integer(m.quantity, 0) && integer(m.unitActivity, 0), '怪物数值无效')
    assert(m.race !== null ? m.quantity > 0 && m.unitActivity > 0 : m.quantity === 0 && m.unitActivity === 0, '空槽残值或有效怪物数值为零')
  })
  assert(v.state.recognitionReview === undefined || (Array.isArray(v.state.recognitionReview) && v.state.recognitionReview.every(text)), '待核对字段无效')
  assert(integer(activity(v as unknown as RunFrame), 0), '活性乘积超过安全整数范围')
  assert(optionalId(v.offerId) && typeof v.offersComplete === 'boolean' && Array.isArray(v.offered) && v.offered.length <= 5, '候选字段无效')
  assert(v.offered.every(c => record(c) && text(c.name) && optionalId(c.cardId)), '候选名称无效')
  assert(Array.isArray(v.passives) && v.passives.every(p => record(p) && text(p.cardId)
    && (p.acquiredRound === null || integer(p.acquiredRound, 0, round))), '常驻字段无效')
  assert(new Set(v.passives.map(p => p.cardId)).size === v.passives.length, '常驻 ID 重复')
}
export function activity(frame: RunFrame): number {
  return frame.state.monsters.reduce((sum, m) => sum + (m.race ? m.quantity * m.unitActivity : 0), 0)
}
export function frameIssues(frame: RunFrame): string[] {
  return [
    ...(frame.confidence < .9 ? ['低置信度画面'] : []),
    ...(frame.state.recognitionReview ?? []),
    ...(frame.phase === 'unknown' ? ['未知阶段'] : []),
    ...(frame.displayedActivity === null ? ['缺少显示总活性'] : frame.displayedActivity !== activity(frame) ? ['总活性校验不符'] : []),
  ]
}
/** Strict schema errors reject input. Low-confidence but well-formed evidence stays archived. */
export function validateArchive(value: unknown): asserts value is RunArchive {
  assert(record(value) && value.schemaVersion === 1 && text(value.runId)
    && oneOf(value.provenance, ['real', 'synthetic']) && text(value.gameVersion) && text(value.rulesVersion), '档案版本/来源无效')
  assert(Array.isArray(value.steps) && value.steps.length <= 10000, '步骤集合无效')
  const stepIds = new Set<string>(), frames = new Map<string, string>(), offers = new Map<string, string>()
  const remember = (f: unknown) => {
    validateFrame(f)
    const serialized = JSON.stringify(f)
    assert(!frames.has(f.id) || frames.get(f.id) === serialized, '同一画面 ID 内容冲突：' + f.id)
    frames.set(f.id, serialized)
    if (f.offerId && f.offersComplete) {
      const signature = JSON.stringify([f.state.round, f.phase, f.offered])
      assert(!offers.has(f.offerId) || offers.get(f.offerId) === signature, '同一发牌 ID 内容冲突：' + f.offerId)
      offers.set(f.offerId, signature)
    }
  }
  for (const s of value.steps) {
    assert(record(s) && text(s.id) && !stepIds.has(s.id) && typeof s.singleActionConfirmed === 'boolean', '重复/无效步骤 ID')
    stepIds.add(s.id); remember(s.before)
    if (s.after !== null) remember(s.after)
    const a = s.action
    assert(record(a) && oneOf(a.type, ['play', 'acquirePermanent', 'redraw', 'advanceSurgery', 'unknown'])
      && optionalId(a.cardId) && optionalId(a.cardName) && oneOf(a.confirmation, ['manual', 'click-observed', 'unknown'])
      && oneOf(a.targetMode, ['choose', 'random', 'none', 'unknown'])
      && slots(a.selectedSlotIds) && slots(a.observedRandomSlotIds) && typeof a.targetsConfirmed === 'boolean', '动作字段无效')
    assert(a.targetMode !== 'random' || a.selectedSlotIds.length === 0, '随机落点不能记录为玩家可选目标')
  }
  assert(record(value.end) && oneOf(value.end.kind, ['incomplete', 'abandoned', 'confirmed-terminal']), '结束状态无效')
  if (value.end.frame !== null) remember(value.end.frame)
  if (value.end.kind === 'confirmed-terminal') {
    assert(value.end.frame !== null, '确认终局需要实际画面')
    const f = value.end.frame as RunFrame
    assert(f.phase === 'terminal' && f.state.round === 14 && frameIssues(f).length === 0, '必须是第13轮结算后的可靠终局，不是奖励倍率或最后截图')
  }
}
export function createRun(input: Pick<RunArchive, 'runId' | 'provenance' | 'gameVersion' | 'rulesVersion'>): RunArchive {
  const run: RunArchive = { ...input, schemaVersion: 1, steps: [], end: { kind: 'incomplete', frame: null } }
  validateArchive(run); return run
}
export function appendStep(run: RunArchive, step: RunStep): RunArchive {
  validateArchive(run)
  assert(run.end.kind === 'incomplete', '已关闭牌局不可追加')
  const old = run.steps.find(s => s.id === step.id)
  if (old) {
    assert(JSON.stringify(old) === JSON.stringify(step), '步骤 ID 冲突，不能覆盖原始证据')
    return structuredClone(run)
  }
  const next = structuredClone({ ...run, steps: [...run.steps, step] })
  validateArchive(next); return next
}
export function finishRun(run: RunArchive, end: RunArchive['end']): RunArchive {
  assert(run.end.kind === 'incomplete', '牌局已经关闭')
  const next = structuredClone({ ...run, end }); validateArchive(next); return next
}
export function stepIssues(step: RunStep): string[] {
  const reasons = frameIssues(step.before).map(i => '前态：' + i)
  if (!step.after) reasons.push('缺少操作后画面')
  else {
    reasons.push(...frameIssues(step.after).map(i => '后态：' + i))
    if (step.after.state.round < step.before.state.round || step.after.state.round > step.before.state.round + 1)
      reasons.push('跨轮缺口或倒退')
  }
  if (!step.singleActionConfirmed) reasons.push('不能确认两帧间只有一次操作')
  if (step.action.type === 'unknown' || step.action.confirmation !== 'manual') reasons.push('实际选择未经人工确认')
  if (step.action.targetMode === 'unknown' || (step.action.targetMode === 'choose' && !step.action.targetsConfirmed)) reasons.push('可选目标未确认')
  if (step.action.targetMode === 'none' && step.action.selectedSlotIds.length) reasons.push('无目标操作含有可选目标')
  if (step.action.type === 'advanceSurgery' && (step.before.state.round < 11 || step.before.state.round > 13
    || step.before.phase !== 'surgery' || step.after?.state.round !== step.before.state.round + 1)) reasons.push('手术推进阶段不符')
  if (step.action.type === 'play' && (step.before.state.round > 10 || !['potion', 'expanded'].includes(step.before.phase))) reasons.push('药剂选择阶段不符')
  if (step.action.type === 'acquirePermanent' && (step.before.state.round > 10 || step.before.phase !== 'permanent')) reasons.push('常驻选择阶段不符')
  if (['play', 'acquirePermanent'].includes(step.action.type)) {
    const a = step.action
    if (!step.before.offersComplete || !step.before.offered.some(c => a.cardId ? c.cardId === a.cardId : c.name === a.cardName))
      reasons.push('选择不在完整候选中')
  }
  if (step.action.targetMode === 'choose' && (step.action.selectedSlotIds.length === 0 || step.action.selectedSlotIds.some(id =>
    !step.before.state.monsters.some(m => m.id === id && m.race)))) reasons.push('可选目标为空或不存在')
  if (step.action.type === 'redraw' && step.after) {
    if (step.after.state.round !== step.before.state.round
      || step.before.redrawsRemaining === null || step.after.redrawsRemaining !== step.before.redrawsRemaining - 1
      || JSON.stringify(step.before.state.monsters) !== JSON.stringify(step.after.state.monsters)) reasons.push('洗牌边界或次数不符')
  }
  return reasons
}
export function terminalLearningIssues(run: RunArchive): string[] {
  const issues: string[] = []
  if (run.end.kind !== 'confirmed-terminal') issues.push('没有确认终局标签')
  if (!run.steps.length || run.steps[0].before.state.round !== 1) issues.push('不是从第1轮开始的完整记录')
  for (const [i, step] of run.steps.entries()) {
    if (stepIssues(step).length) issues.push('存在未确认/不完整步骤')
    if (i > 0 && run.steps[i - 1].after?.id !== step.before.id) issues.push('相邻步骤没有连续画面证据')
    if ([step.before, step.after].some(f => f?.passives.some(p => p.acquiredRound === null))) issues.push('常驻获得回合未知')
  }
  if (run.end.kind === 'confirmed-terminal' && run.steps.at(-1)?.after?.id !== run.end.frame?.id) issues.push('终局未连接到最后操作')
  return [...new Set(issues)]
}
export function parseArchives(jsonl: string): RunArchive[] {
  const ids = new Set<string>()
  return jsonl.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).map((line, index) => {
    let value: unknown
    try { value = JSON.parse(line); validateArchive(value) } catch (error) { throw new Error(`JSONL第${index + 1}条：${String(error)}`) }
    const run = value as RunArchive
    assert(!ids.has(run.runId), '重复 runId，禁止按两场统计：' + run.runId); ids.add(run.runId)
    return run
  })
}
export function serializeArchives(runs: RunArchive[]): string {
  const content = runs.map(r => JSON.stringify(r)).join('\n') + (runs.length ? '\n' : '')
  parseArchives(content); return content
}
