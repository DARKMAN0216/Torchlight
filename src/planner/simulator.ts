import { raceIds, rarityIds } from '../types/game'
import { pick, shuffled, type Random } from './random'
import { sampleRarityStats } from './empirical'
import {
  ModelUnavailableError, type CardDefinition, type Condition, type Effect, type Filter,
  type GameAction, type GameEvent, type Monster, type PlannerModel, type PlannerState,
  type Selector, type SimulationResult, type Slot, type TargetRule,
} from './types'

export const cloneState = (state: PlannerState): PlannerState => structuredClone(state)
export function finalActivity(state: PlannerState): number {
  const total = state.slots.reduce((sum, s) => sum + (s.monster ? s.monster.quantity * s.monster.unitActivity : 0), 0)
  if (!Number.isSafeInteger(total)) throw new ModelUnavailableError('总活性超出安全整数范围')
  return total
}
export function validateState(state: PlannerState): void {
  if (state.totalRounds !== 13 || state.decisionRounds !== 10 || state.maxGroups !== 6
    || !Number.isInteger(state.round) || state.round < 1 || state.round > 14)
    throw new Error('回合或规则配置无效')
  if (state.slots.length !== 6 || new Set(state.slots.map(s => s.slotId)).size !== 6
    || state.slots.some(s => !s.slotId)) throw new Error('必须保留六个唯一槽位')
  const instances = state.slots.flatMap(s => s.monster ? [s.monster.instanceId] : [])
  if (new Set(instances).size !== instances.length) throw new Error('怪物实例 ID 重复')
  for (const { monster: m } of state.slots) if (m) {
    if (!m.monsterId || !m.instanceId || !raceIds.includes(m.race) || !rarityIds.includes(m.rarity)
      || !Number.isSafeInteger(m.quantity) || m.quantity <= 0
      || !Number.isSafeInteger(m.unitActivity) || m.unitActivity <= 0) throw new Error('怪物属性必须是合法正整数')
  }
  if (!Number.isSafeInteger(state.redrawsRemaining) || state.redrawsRemaining < 0
    || !Number.isSafeInteger(state.specialPotionStage) || state.specialPotionStage < 0
    || !Number.isSafeInteger(state.nextInstanceId) || state.nextInstanceId < 0)
    throw new Error('重抽次数、阶段或实例计数无效')
  if (new Set(state.persistentEffects.map(p => p.cardId)).size !== state.persistentEffects.length)
    throw new Error('常驻器械重复')
  for (const p of state.persistentEffects) {
    if (!Number.isInteger(p.acquiredRound) || p.acquiredRound < 0 || p.acquiredRound > state.round
      || p.firstEligibleRound !== p.acquiredRound + 1 || !Number.isSafeInteger(p.triggerCount) || p.triggerCount < 0)
      throw new Error('常驻获得轮数或首次生效轮数无效')
  }
  finalActivity(state)
}
export function matches(m: Monster, filter: Filter = {}): boolean {
  return (!filter.race || m.race === filter.race) && (!filter.excludeRace || m.race !== filter.excludeRace)
    && (!filter.rarities || filter.rarities.includes(m.rarity))
    && (filter.minQuantityExclusive === undefined || m.quantity > filter.minQuantityExclusive)
}
const occupied = (state: PlannerState, filter?: Filter) => state.slots.filter(s => s.monster && matches(s.monster, filter))
export const conditionMet = (state: PlannerState, condition?: Condition) =>
  !condition || occupied(state, condition.filter).length >= condition.minGroups

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  return items.flatMap((v, i) => combinations(items.slice(i + 1), size - 1).map(rest => [v, ...rest]))
}
export function targetCombinations(state: PlannerState, rule?: TargetRule): string[][] {
  if (!rule) return [[]]
  const candidates = occupied(state, rule.filter)
  return Array.from({ length: Math.max(0, rule.max - rule.min + 1) }, (_, i) => rule.min + i)
    .flatMap(n => combinations(candidates, n))
    .filter(group => !rule.sameRarity || new Set(group.map(s => s.monster!.rarity)).size <= 1)
    .map(group => group.map(s => s.slotId))
}
function eligible(state: PlannerState, card: CardDefinition): boolean {
  const e = card.eligibility
  return (!e || (state.round >= (e.minRound ?? 1) && state.round <= (e.maxRound ?? 10)
    && (e.stage === undefined || e.stage === state.specialPotionStage) && conditionMet(state, e.condition)))
    && (!card.acquirePersistentId || !state.persistentEffects.some(p => p.cardId === card.acquirePersistentId))
}
function cardById(model: PlannerModel, id: string): CardDefinition {
  const card = model.cards.find(c => c.id === id)
  if (!card) throw new ModelUnavailableError('未建模卡牌：' + id)
  return card
}
export function getLegalActions(state: PlannerState, model: PlannerModel): GameAction[] {
  validateState(state)
  if (state.recognitionReview.length) throw new ModelUnavailableError('识别待核对：' + state.recognitionReview.join('；'))
  if (state.round > 13) return []
  if (state.round > 10) return [{ type: 'advanceSurgeryPlanRound' }]
  const actions: GameAction[] = []
  for (const id of new Set(state.offeredCardIds)) {
    const card = cardById(model, id)
    if (!eligible(state, card)) continue
    if (card.unsupportedReason) {
      // Keep unsupported choices visible to the planner; never silently drop them from comparisons.
      actions.push({ type: 'playCard', cardId: id, selectedSlotIds: [] })
      continue
    }
    if (card.targeting?.mode === 'random') {
      if (targetCombinations(state, card.targeting).length)
        actions.push({ type: 'playCard', cardId: id, selectedSlotIds: [] })
    } else {
      for (const targets of targetCombinations(state, card.targeting))
        actions.push({ type: 'playCard', cardId: id, selectedSlotIds: targets })
    }
  }
  if (state.redrawsRemaining > 0) actions.push({ type: 'redraw' })
  return actions
}
export function drawOffer(state: PlannerState, model: PlannerModel, random: Random): string[] {
  if (!Number.isInteger(model.offerCount) || model.offerCount < 1) throw new Error('发牌数量无效')
  const pool = [...new Set(model.offerPool)].map(id => cardById(model, id)).filter(c => eligible(state, c))
  if (!pool.length || (!model.offersWithReplacement && pool.length < model.offerCount))
    throw new ModelUnavailableError('合法牌池不足，不能静默减少发牌数量')
  return model.offersWithReplacement
    ? Array.from({ length: model.offerCount }, () => pick(pool, random).id)
    : shuffled(pool, random).slice(0, model.offerCount).map(c => c.id)
}
export const actionKey = (action: GameAction): string => action.type === 'playCard'
  ? action.cardId + ':' + [...action.selectedSlotIds].sort().join(',') : action.type

/** Pure transition. It never writes predicted state back to OCR or user storage. */
export function simulateAction(
  input: PlannerState, action: GameAction, model: PlannerModel, random: Random,
): SimulationResult {
  if (!Number.isSafeInteger(model.maxEvents) || model.maxEvents < 1 || model.maxEvents > 100000)
    throw new Error('事件上限必须是1至100000之间的整数')
  if (!getLegalActions(input, model).some(a => actionKey(a) === actionKey(action)))
    throw new Error('非法动作：' + actionKey(action))
  const state = cloneState(input)
  const events: GameEvent[] = []
  const queue: GameEvent[] = []
  const warnings = new Set<string>()
  let selected: string[] = []
  const emit = (event: Omit<GameEvent, 'round'>) => {
    if (events.length >= model.maxEvents) throw new ModelUnavailableError('事件链超过上限，可能存在循环')
    const full = structuredClone({ ...event, round: state.round })
    events.push(full); queue.push(full)
  }
  const select = (selector: Selector, event?: GameEvent): Slot[] => {
    if (selector.mode === 'selected') return state.slots.filter(s => selected.includes(s.slotId) && s.monster)
    if (selector.mode === 'eventMonster') return state.slots.filter(s =>
      s.monster && s.slotId === event?.slotId && s.monster.instanceId === event.after?.instanceId)
    const candidates = occupied(state, selector.filter)
    if (!candidates.length || selector.mode === 'all') return candidates
    if (selector.mode === 'random') return [pick(candidates, random)]
    const values = candidates.map(s => s.monster!.quantity * s.monster!.unitActivity)
    const best = selector.mode === 'highest' ? Math.max(...values) : Math.min(...values)
    return [pick(candidates.filter((_, i) => values[i] === best), random)]
  }
  const remove = (slot: Slot, source: string) => {
    if (!slot.monster) return
    const before = { ...slot.monster }; slot.monster = null
    emit({ type: 'removeSucceeded', source, slotId: slot.slotId, before })
  }
  const add = (spec: Extract<Effect, { type: 'add' }>['spec'], source: string) => {
    emit({ type: 'addAttempted', source })
    const empty = state.slots.find(s => !s.monster)
    if (!empty) { emit({ type: 'addFailedBoardFull', source }); return }
    let base = spec.base
    if (!base) {
      const pool = model.monsters.filter(m => matches({ ...m, instanceId: '' }, spec.filter))
      if (!pool.length) throw new ModelUnavailableError('缺少合法生成怪物及其基础数值：' + source)
      // Hierarchical uniform distribution: race -> rarity -> concrete monster.
      const race = pick([...new Set(pool.map(m => m.race))], random)
      const racePool = pool.filter(m => m.race === race)
      const rarity = pick([...new Set(racePool.map(m => m.rarity))], random)
      base = pick(racePool.filter(m => m.rarity === rarity), random)
      warnings.add('随机生成按种群→稀有度→怪物分层等概率；基础数值来自显式字典')
    }
    let instanceId: string
    do { instanceId = 'generated-' + state.nextInstanceId++ }
    while (state.slots.some(s => s.monster?.instanceId === instanceId))
    empty.monster = { ...base, instanceId,
      quantity: base.quantity + (spec.quantityBonus ?? 0),
      unitActivity: base.unitActivity + (spec.activityBonus ?? 0) }
    emit({ type: 'addSucceeded', source, slotId: empty.slotId, after: empty.monster })
  }
  const apply = (effects: Effect[], source: string, event?: GameEvent) => {
    for (const effect of effects) {
      if (!conditionMet(state, effect.condition)) continue
      switch (effect.type) {
        case 'ifSelected': {
          const previous = selected
          selected = state.slots.filter(s => selected.includes(s.slotId) && s.monster && matches(s.monster, effect.filter)).map(s => s.slotId)
          if (selected.length) apply(effect.effects, source, event)
          selected = previous
          break
        }
        case 'stats': {
          const repeats = effect.repeatPerRace ? occupied(state, { race: effect.repeatPerRace }).length : 1
          for (const slot of select(effect.target, event)) {
            const m = slot.monster!
            const rarityRepeat = effect.awakenedRarityRepeat && m.race === 'awakened'
              ? ({ common: 1, magic: 2, rare: 3, boss: 3 }[m.rarity]) : 1
            m.quantity += (effect.quantity ?? 0) * repeats
            m.unitActivity = m.unitActivity * (effect.activityFactor ?? 1) + (effect.activity ?? 0) * repeats * rarityRepeat
          }
          break
        }
        case 'remove':
          select(effect.target, event).forEach(s => remove(s, source)); break
        case 'removeNeighbor':
          for (const id of selected) {
            const index = state.slots.findIndex(s => s.slotId === id) + effect.offset
            if (index >= 0 && index < 6) remove(state.slots[index], source)
          }
          break
        case 'add':
          if (!Number.isSafeInteger(effect.count) || effect.count < 1 || effect.count > model.maxEvents)
            throw new Error('添加次数必须是事件预算内的正整数')
          for (let i = 0; i < effect.count; i++) add(effect.spec, source)
          break
        case 'chance':
          if (effect.probability < 0 || effect.probability > 1 || !Number.isFinite(effect.probability))
            throw new Error('概率无效')
          if (random() < effect.probability) apply(effect.effects, source, event)
          break
        case 'mutate':
          for (const slot of select(effect.target, event)) {
            const m = slot.monster!, before = { ...m }
            const race = effect.race === 'random' ? pick(raceIds, random) : effect.race ?? m.race
            if (effect.onlyIfDifferentRace && race === m.race) continue
            const rarity = m.rarity === 'boss' ? 'boss' : effect.rarity
              ?? rarityIds[Math.min(3, Math.max(0, rarityIds.indexOf(m.rarity) + (effect.upgradeSteps ?? 0)))]
            const identities = model.monsters.filter(base => base.race === race && base.rarity === rarity)
            const afterId = identities.length ? pick(identities, random).monsterId : undefined
            if (rarity !== m.rarity) {
              const stats = sampleRarityStats(before, rarity, source, afterId, model, random)
              m.quantity = stats.quantity; m.unitActivity = stats.unitActivity; warnings.add(stats.warning)
            }
            m.race = race; m.rarity = rarity
            if (before.race !== race || before.rarity !== rarity) m.monsterId = afterId ?? 'unresolved:' + race + ':' + rarity
            m.unitActivity += effect.activityBonus ?? 0
            if (before.race !== race || before.rarity !== rarity)
              emit({ type: 'mutationCompleted', source, slotId: slot.slotId, before, after: m })
          }
          break
        case 'fuse': {
          const targets = select({ mode: 'selected' })
          if (targets.length !== 2) throw new ModelUnavailableError('当前融合算子要求恰好两组，其他数量需独立规则')
          const monsters = targets.map(s => ({ ...s.monster! }))
          const rarity = effect.rarity ?? monsters[0].rarity
          if (!effect.rarity && monsters.some(m => m.rarity !== rarity))
            throw new ModelUnavailableError('混合稀有度融合的结果稀有度尚未确定')
          targets.forEach(s => remove(s, source))
          add({ base: { monsterId: 'unresolved:fusion:' + effect.race + ':' + rarity,
            race: effect.race, rarity,
            quantity: monsters.reduce((n, m) => n + m.quantity, 0),
            unitActivity: monsters.reduce((n, m) => n + m.unitActivity, 0) } }, source)
          emit({ type: 'fusionCompleted', source })
          break
        }
      }
    }
  }
  const active = [...state.persistentEffects].sort((a, b) => a.acquiredRound - b.acquiredRound)
  if (model.persistentOrder === 'reverse') active.reverse()
  const order = model.persistentOrder === 'random' ? shuffled(active, random) : active
  for (const runtime of order) {
    if (!runtime.enabled) continue
    const def = model.persistent.find(p => p.id === runtime.cardId)
    if (!def || def.unsupportedReason) throw new ModelUnavailableError('常驻未完整建模：' + runtime.cardId + ' ' + (def?.unsupportedReason ?? ''))
  }
  const drain = () => {
    while (queue.length) {
      const event = queue.shift()!
      for (const runtime of order) {
        if (!runtime.enabled || state.round < runtime.firstEligibleRound) continue
        const definition = model.persistent.find(p => p.id === runtime.cardId)!
        for (const trigger of definition.triggers) {
          const eventRace = event.type === 'removeSucceeded' ? event.before?.race : event.after?.race
          if (trigger.event !== event.type || !conditionMet(state, trigger.condition)
            || (trigger.eventRace && eventRace !== trigger.eventRace)
            || (trigger.excludedEventRace && eventRace === trigger.excludedEventRace)
            || (trigger.everyRounds && state.round % trigger.everyRounds !== 0)) continue
          runtime.triggerCount++
          const original = selected; selected = []
          apply(trigger.effects, definition.id, event)
          selected = original
        }
      }
    }
  }
  if (action.type === 'redraw') {
    state.redrawsRemaining--
    // Redraw replaces candidates in the same round; no round end and no passive trigger.
    state.offeredCardIds = drawOffer(state, model, random)
  } else {
    if (action.type === 'playCard') {
      const card = cardById(model, action.cardId)
      if (card.unsupportedReason) throw new ModelUnavailableError(card.name + '：' + card.unsupportedReason)
      selected = card.targeting?.mode === 'random'
        ? pick(targetCombinations(state, card.targeting), random) : action.selectedSlotIds
      emit({ type: 'cardPlayed', source: card.id })
      apply(card.effects, card.id)
      if (card.acquirePersistentId) state.persistentEffects.push({
        cardId: card.acquirePersistentId, acquiredRound: state.round, firstEligibleRound: state.round + 1,
        triggerCount: 0, enabled: true,
      })
      if (card.nextStage !== undefined) state.specialPotionStage = card.nextStage
    }
    drain()
    emit({ type: 'roundEnd', source: 'round' }); drain()
    state.round++
    state.offeredCardIds = state.round <= 10 ? drawOffer(state, model, random) : []
  }
  validateState(state)
  return { state, events, warnings: [...warnings] }
}
