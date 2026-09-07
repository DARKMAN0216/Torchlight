import type { GameState as LegacyState } from '../types/game'
import type { RecognitionSnapshot } from '../recognition/contracts'
import { cloneState, finalActivity, validateState } from './simulator'
import type { SearchReport } from './search'
import { ModelUnavailableError, type GameAction, type PersistentRuntimeState, type PlannerState, type RarityTransitionSample } from './types'

export function fromLegacyState(
  legacy: LegacyState,
  metadata: {
    persistentEffects: PersistentRuntimeState[]; offeredCardIds: string[]; redrawsRemaining: number
    specialPotionStage: number; monsterIdsBySlot?: Record<string, string>
  },
): PlannerState {
  const state: PlannerState = {
    round: legacy.round, totalRounds: 13, decisionRounds: 10, maxGroups: 6,
    slots: legacy.monsters.map(m => ({ slotId: m.id, monster: m.race ? {
      instanceId: 'observed-' + m.id, monsterId: metadata.monsterIdsBySlot?.[m.id] ?? 'unresolved:' + m.race + ':' + m.rarity,
      race: m.race, rarity: m.rarity, quantity: m.quantity, unitActivity: m.unitActivity,
    } : null })),
    persistentEffects: structuredClone(metadata.persistentEffects), offeredCardIds: [...metadata.offeredCardIds],
    redrawsRemaining: metadata.redrawsRemaining, specialPotionStage: metadata.specialPotionStage,
    nextInstanceId: 0, recognitionReview: [...(legacy.recognitionReview ?? [])],
  }
  validateState(state)
  return state
}

/** Strict full-frame adapter. Missing observations never inherit old monster stats. */
export function fromRecognitionSnapshot(
  predicted: PlannerState, snapshot: RecognitionSnapshot, minimumConfidence = .9,
): PlannerState {
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < .9 || minimumConfidence > 1)
    throw new Error('规划校准置信度门槛必须在0.9至1之间')
  const required = <T>(value: { value: T; confidence: number } | undefined, label: string): T => {
    if (!value || !Number.isFinite(value.confidence) || value.confidence < minimumConfidence || value.confidence > 1)
      throw new ModelUnavailableError('识别待核对：' + label)
    return value.value
  }
  const round = required(snapshot.round, '回合')
  if (round !== predicted.round) throw new ModelUnavailableError('观察回合与本次预测不匹配；可能是旧帧或跳过了操作')
  const phase = required(snapshot.phase, '阶段')
  if (!(round > 10 ? ['surgeryPlanSelection', 'roundEndResolution'] : ['potionSelection', 'expandedPotionSelection', 'candidateSelection']).includes(phase))
    throw new ModelUnavailableError('当前阶段不属于已支持的培养/手术推进边界：' + phase)
  const slots = snapshot.monsterSlots
  if (!slots || slots.length !== 6 || new Set(slots.map(s => s.slotId)).size !== 6)
    throw new ModelUnavailableError('需要完整六槽识别，缺失槽不能视为空槽')
  const state = cloneState(predicted)
  state.slots = predicted.slots.map(previous => {
    const observed = slots.find(s => s.slotId === previous.slotId)
    if (!observed) throw new ModelUnavailableError('槽位映射不一致')
    if (!required(observed.occupied, previous.slotId + '占用')) {
      if (observed.name?.value || (observed.quantity?.value ?? 0) > 0 || (observed.unitActivity?.value ?? 0) > 0)
        throw new ModelUnavailableError('空槽含有矛盾的怪物信息')
      return { slotId: previous.slotId, monster: null }
    }
    const race = required(observed.raceId, '种群')
    const rarity = required(observed.rarity, '稀有度')
    const quantity = required(observed.quantity, '数量')
    const unitActivity = required(observed.unitActivity, '单位活性')
    const monsterId = observed.name && observed.name.confidence >= minimumConfidence
      ? observed.name.value.normalize('NFKC').replace(/\s+/g, '') : 'unresolved:' + race + ':' + rarity
    if (observed.displayedTotalActivity && required(observed.displayedTotalActivity, '组总活性') !== quantity * unitActivity)
      throw new ModelUnavailableError('组总活性校验失败')
    return { slotId: previous.slotId, monster: {
      monsterId, instanceId: previous.monster?.instanceId ?? 'observed-' + snapshot.capturedAt + '-' + previous.slotId,
      race, rarity, quantity, unitActivity,
    } }
  })
  const total = required(snapshot.displayedFinalActivity, '总活性')
  if (finalActivity(state) !== total) throw new ModelUnavailableError('总活性校验失败')
  state.offeredCardIds = round > 10 ? [] : snapshot.candidateCardIds.map(c => required(c, '候选卡'))
  if (round <= 10 && (!state.offeredCardIds.length || state.offeredCardIds.length !== predicted.offeredCardIds.length))
    throw new ModelUnavailableError('缺少完整候选卡 ID')
  const passives = (snapshot.persistentCardIds ?? (snapshot.persistentCardId ? [snapshot.persistentCardId] : undefined))
  if (!passives) throw new ModelUnavailableError('缺少常驻列表，不能猜测是否新增器械')
  const actualIds = passives.map(p => required(p, '常驻器械')).sort()
  const predictedIds = state.persistentEffects.filter(p => p.enabled).map(p => p.cardId).sort()
  if (JSON.stringify(actualIds) !== JSON.stringify(predictedIds))
    throw new ModelUnavailableError('常驻列表有变化，需要记录新器械的获得回合')
  state.redrawsRemaining = required(snapshot.rerollsRemaining, '剩余重抽次数')
  state.recognitionReview = []
  try { validateState(state) } catch (error) {
    throw new ModelUnavailableError('识别状态无效：' + (error instanceof Error ? error.message : String(error)))
  }
  return state
}
export interface DecisionRecord {
  schemaVersion: 1
  id: string
  runId: string
  capturedAt: string
  modelVersion: string
  action: GameAction
  before: PlannerState
  predicted: PlannerState
  actual?: PlannerState
  search?: SearchReport
  accepted: boolean
  trainingEligible: boolean
  issues: string[]
  activityError?: number
  changedSlots: string[]
}
export function reconcileObservation(input: {
  id: string; runId: string; capturedBefore: string; before: PlannerState; predicted: PlannerState
  action: GameAction; snapshot: RecognitionSnapshot; modelVersion: string; search?: SearchReport
}): { state: PlannerState; record: DecisionRecord } {
  const record: DecisionRecord = {
    schemaVersion: 1, id: input.id, runId: input.runId, capturedAt: input.snapshot.capturedAt,
    modelVersion: input.modelVersion, action: structuredClone(input.action), before: cloneState(input.before),
    predicted: cloneState(input.predicted), search: input.search ? structuredClone(input.search) : undefined,
    accepted: false, trainingEligible: false, issues: [], changedSlots: [],
  }
  try {
    if (!input.id || !input.runId || !Number.isFinite(Date.parse(input.capturedBefore))
      || !Number.isFinite(Date.parse(input.snapshot.capturedAt))
      || Date.parse(input.snapshot.capturedAt) <= Date.parse(input.capturedBefore))
      throw new ModelUnavailableError('记录 ID、对局 ID 或时间无效，拒绝旧帧和重复帧')
    const actual = fromRecognitionSnapshot(input.predicted, input.snapshot)
    record.accepted = true
    record.actual = actual
    record.activityError = finalActivity(actual) - finalActivity(input.predicted)
    record.changedSlots = actual.slots.filter((s, i) => {
      const a = s.monster, p = input.predicted.slots[i].monster
      return a?.monsterId !== p?.monsterId || a?.race !== p?.race || a?.rarity !== p?.rarity
        || a?.quantity !== p?.quantity || a?.unitActivity !== p?.unitActivity
    }).map(s => s.slotId)
    record.trainingEligible = !input.before.recognitionReview.length
      && [...input.before.slots, ...actual.slots].every(s => !s.monster || !s.monster.monsterId.startsWith('unresolved:'))
    return { state: cloneState(actual), record }
  } catch (error) {
    if (!(error instanceof ModelUnavailableError)) throw error
    record.issues.push(error.message)
    const state = cloneState(input.before)
    state.recognitionReview = [...new Set([...state.recognitionReview, error.message])]
    return { state, record }
  }
}

/** Only isolated, reviewed effect observations may teach rarity changes.
 * Whole-round before/after differences contain potion bonuses and passive effects.
 */
export function extractRaritySample(
  record: DecisionRecord, evidence: { isolatedMutation: boolean; slotId: string; reviewed: boolean },
): RarityTransitionSample {
  if (!record.accepted || !record.trainingEligible || !record.actual || !evidence.reviewed || !evidence.isolatedMutation
    || record.action.type !== 'playCard')
    throw new ModelUnavailableError('稀有度训练需要人工核对的独立变异观测，不能使用整轮混合增益')
  const before = record.before.slots.find(s => s.slotId === evidence.slotId)?.monster
  const after = record.actual.slots.find(s => s.slotId === evidence.slotId)?.monster
  if (!before || !after || before.rarity === after.rarity)
    throw new ModelUnavailableError('缺少同槽位稀有度变化')
  return { id: record.id + ':' + evidence.slotId, cardId: record.action.cardId,
    beforeMonsterId: before.monsterId, afterMonsterId: after.monsterId, fromRarity: before.rarity, toRarity: after.rarity,
    beforeQuantity: before.quantity, afterQuantity: after.quantity,
    beforeUnitActivity: before.unitActivity, afterUnitActivity: after.unitActivity }
}
export function serializeRecords(records: DecisionRecord[]): string {
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('决策记录 ID 重复')
  return records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '')
}
