import { raceIds, rarityIds } from '../types/game'
import { chance, pick, shuffled, type Random } from './random'
import { sampleRarityStats } from './empirical'
import { freshRarityBase } from './rarityBases'
import { applySpecialPotion, cocoonId } from './specialPotions'
import {
  ModelUnavailableError, type CardDefinition, type Condition, type Effect, type Filter,
  type GameAction, type GameEvent, type Monster, type PlannerModel, type PlannerState,
  type Selector, type SimulationResult, type Slot, type TargetRule, type PassiveObservations,
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
    if (m.monsterId === cocoonId && (m.race !== 'swarm' || m.rarity !== 'boss'))
      throw new ModelUnavailableError('空心茧身份与种群/稀有度矛盾')
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
    && (filter.minActivityExclusive === undefined || m.unitActivity > filter.minActivityExclusive)
}
const occupied = (state: PlannerState, filter?: Filter) => state.slots.filter(s => s.monster && matches(s.monster, filter))
export const conditionMet = (state: PlannerState, condition?: Condition): boolean =>
  !condition || (occupied(state, condition.filter).length >= condition.minGroups
    && occupied(state, condition.filter).length <= (condition.maxGroups ?? Infinity)
    && (condition.all ?? []).every(c => conditionMet(state, c)))

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
  const special = state.specialOffer
  let extras: string[] = []
  if (special) {
    if (!['additional', 'replace'].includes(special.mode) || !Number.isSafeInteger(special.count) || special.count < 1 || special.count > 6)
      throw new ModelUnavailableError('特殊发牌配置无效')
    const pool = model.specialOfferPools?.[special.poolId]
    if (!pool?.length) throw new ModelUnavailableError(`特殊牌池 ${special.poolId} 概率未知；高概率不等于保证，需F8实牌或显式情景权重`)
    if (new Set(pool.map(p => p.cardId)).size !== pool.length || pool.some(p => !Number.isFinite(p.weight) || p.weight <= 0))
      throw new ModelUnavailableError('特殊牌池包含重复卡或非法权重')
    let available = pool.filter(p => eligible(state, cardById(model, p.cardId)))
    for (let i = 0; i < special.count; i++) {
      if (!available.length) throw new ModelUnavailableError('特殊候选不足，不能静默减少发牌数量')
      const sum = available.reduce((n, p) => n + p.weight, 0)
      if (!Number.isFinite(sum)) throw new ModelUnavailableError('特殊权重溢出')
      const weights = available.map(p => p.weight / sum)
      let index = 0
      if (available.length > 1) {
        if (random.choose) index = random.choose(weights)
        else { let value = random(); while (index < weights.length - 1 && value >= weights[index]) value -= weights[index++] }
      }
      extras.push(available[index].cardId)
      if (!model.offersWithReplacement) available = available.filter((_, i) => i !== index)
    }
    if (special.mode === 'replace') return extras
  }
  const pool = [...new Set(model.offerPool)].map(id => cardById(model, id))
    .filter(c => eligible(state, c) && (model.offersWithReplacement || !extras.includes(c.id)))
  if (!pool.length || (!model.offersWithReplacement && pool.length < model.offerCount))
    throw new ModelUnavailableError('合法牌池不足，不能静默减少发牌数量')
  const ordinary = model.offersWithReplacement
    ? Array.from({ length: model.offerCount }, () => pick(pool, random).id)
    : shuffled(pool, random).slice(0, model.offerCount).map(c => c.id)
  return [...ordinary, ...extras]
}
export const actionKey = (action: GameAction): string => action.type === 'playCard'
  ? action.cardId + ':' + [...action.selectedSlotIds].sort().join(',') : action.type

/** Pure transition. It never writes predicted state back to OCR or user storage. */
export function simulateAction(
  input: PlannerState, action: GameAction, model: PlannerModel, random: Random,
): SimulationResult {
  if (!getLegalActions(input, model).some(a => actionKey(a) === actionKey(action)))
    throw new Error('非法动作：' + actionKey(action))
  return resolveTransition(input, action, model, random)
}

/** Evaluate already-observed card events without drawing cards or advancing a round. */
export function resolvePersistentEvents(
  input: PlannerState, initialEvents: GameEvent[], model: PlannerModel, random: Random,
  observations: PassiveObservations = {},
): SimulationResult {
  validateState(input)
  return resolveTransition(input, undefined, model, random, initialEvents, observations)
}

/** Shared desktop potion preview: no drawing, no round advance, no observed-state writes. */
export function resolvePotionPreview(input: PlannerState, card: CardDefinition, targets: string[],
  model: PlannerModel, random: Random, includeRoundEnd: boolean): SimulationResult {
  validateState(input)
  if (input.round > 10) throw new ModelUnavailableError('已进入手术方案阶段，不再预览药剂选择')
  const legal = targetCombinations(input, card.targeting)
  if (!legal.length || (card.targeting?.mode !== 'random'
    && !legal.some(ids => JSON.stringify([...ids].sort()) === JSON.stringify([...targets].sort()))))
    throw new ModelUnavailableError(card.name + '：目标不足或选择不合法')
  return resolveTransition(input, undefined, model, random, [], {}, { card, targets, includeRoundEnd })
}

function resolveTransition(
  input: PlannerState, action: GameAction | undefined, model: PlannerModel, random: Random,
  initialEvents: GameEvent[] = [],
  observations: PassiveObservations = {},
  potion?: { card: CardDefinition; targets: string[]; includeRoundEnd: boolean },
): SimulationResult {
  if (!Number.isSafeInteger(model.maxEvents) || model.maxEvents < 1 || model.maxEvents > 100000)
    throw new Error('事件上限必须是1至100000之间的整数')
  const state = cloneState(input)
  const events: GameEvent[] = []
  const queue: GameEvent[] = []
  const warnings = new Set<string>()
  let selected: string[] = []
  const observationOffsets: Record<string, number> = {}
  const emit = (event: Omit<GameEvent, 'round'>) => {
    if (events.length >= model.maxEvents) throw new ModelUnavailableError('事件链超过上限，可能存在循环')
    const full = structuredClone({ ...event, round: state.round })
    events.push(full); queue.push(full)
  }
  const select = (selector: Selector, event?: GameEvent, source?: string): Slot[] => {
    if (selector.mode === 'selected') return state.slots.filter(s => selected.includes(s.slotId) && s.monster)
    if (selector.mode === 'eventMonster') return state.slots.filter(s =>
      s.monster && s.slotId === event?.slotId && s.monster.instanceId === event.after?.instanceId)
    const candidates = occupied(state, selector.filter)
    if (!candidates.length || selector.mode === 'all') return candidates
    if (selector.mode === 'random') {
      const observed = source && observations.targetSlotIds?.[source]
      if (observed) {
        const offset = observationOffsets[source!] ?? 0
        const target = candidates.find(s => s.slotId === observed[offset])
        if (!target) throw new ModelUnavailableError('常驻实际随机目标不完整或不合法：' + source)
        observationOffsets[source!] = offset + 1
        return [target]
      }
      return [pick(candidates, random)]
    }
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
    return empty
  }
  const apply = (effects: Effect[], source: string, event?: GameEvent) => {
    for (const effect of effects) {
      if (!conditionMet(state, effect.condition)) continue
      switch (effect.type) {
        case 'specialPotion':
          applySpecialPotion(effect.kind, { state, model, random, source, add, remove, emit, warn: message => warnings.add(message) })
          break
        case 'confirmedPotion': {
          warnings.add('2026-09-08用户确认药剂规则；随机稀有度/种群暂按等概率抽样，非实测出率')
          const identity = (race: Monster['race'], rarity: Monster['rarity']) => `class:${race}:${rarity}`
          const changeIdentity = (slot: Slot, race: Monster['race'], rarity: Monster['rarity']) => {
            const m = slot.monster!, before = { ...m }
            m.race = race; m.rarity = rarity; m.monsterId = identity(race, rarity)
            if (before.race !== race || before.rarity !== rarity || before.monsterId === cocoonId)
              emit({ type: 'mutationCompleted', source, slotId: slot.slotId, before, after: m })
          }
          const birth = (race?: Monster['race'], rarity?: Monster['rarity'], quantityBonus = 0, activityBonus = 0) => {
            if (!state.slots.some(s => !s.monster)) {
              // Failure is still a real attempt, even when no base data exists.
              add({}, source); return false
            }
            // Validate the full legal rarity support before sampling. A partial
            // dictionary cannot silently exclude rare/boss outcomes.
            if (!rarity) rarityIds.forEach(r => freshRarityBase(model, r))
            const chosenRarity = rarity ?? pick(rarityIds, random)
            const chosenRace = race ?? pick(raceIds, random)
            add({ base: { monsterId: identity(chosenRace, chosenRarity), race: chosenRace,
              rarity: chosenRarity, ...freshRarityBase(model, chosenRarity) }, quantityBonus, activityBonus }, source)
            return true
          }
          const targets = select({ mode: 'selected' })
          if (effect.kind === 'twinSwarm') {
            const target = targets[0]
            if (!target) throw new ModelUnavailableError('孪生激素需要一个目标')
            changeIdentity(target, 'swarm', target.monster!.rarity)
            birth('swarm', target.monster!.rarity)
          } else if (effect.kind === 'eggshell') {
            const target = targets[0]
            if (!target) throw new ModelUnavailableError('卵壳药粉没有随机目标')
            target.monster!.quantity += 25
            if (target.monster!.race === 'swarm') birth('swarm', target.monster!.rarity, 25)
          } else if (effect.kind === 'viscousBile') {
            const target = targets[0]
            const right = target && state.slots[state.slots.indexOf(target) + 1]
            if (!target) throw new ModelUnavailableError('黏稠胆汁需要一个目标')
            target.monster!.unitActivity += 31
            if (right?.monster) {
              changeIdentity(right, target.monster!.race, target.monster!.rarity)
              right.monster!.unitActivity += 31
            }
          } else if (effect.kind === 'swarmFusion') {
            if (targets.length !== 2) throw new ModelUnavailableError('蜕生皮溶液必须选择两组')
            const quantity = targets.reduce((sum, s) => sum + s.monster!.quantity, 0)
            const unitActivity = targets.reduce((sum, s) => sum + s.monster!.unitActivity, 0)
            const rarity = pick(rarityIds, random)
            targets.forEach(s => remove(s, source))
            add({ base: { monsterId: identity('swarm', rarity), race: 'swarm', rarity, quantity, unitActivity } }, source)
            emit({ type: 'fusionCompleted', source })
          } else if (effect.kind === 'xeno') {
            targets.forEach(s => remove(s, source))
            for (let i = 0; i < 4; i++) birth(undefined, undefined, 0, 5)
          } else if (effect.kind === 'insectLure') {
            for (let i = 0; i < 4; i++) {
              const succeeded = birth('swarm')
              if (!succeeded) for (const slot of occupied(state, { race: 'swarm' })) {
                slot.monster!.quantity += 15; slot.monster!.unitActivity += 10
              }
              // Resolve each attempt before the next, so previously added groups
              // (including any passive mutation) are part of the next board.
              drain()
            }
            warnings.add('诱虫剂逐次添加/溢出并结算常驻；与添加变异常驻的精确先后仍需实战校准')
          } else if (effect.kind === 'oviposition') {
            birth('swarm')
            if (chance(.5, random)) { birth('swarm'); birth('swarm') }
          }
          break
        }
        case 'ifSelected': {
          const previous = selected
          selected = state.slots.filter(s => selected.includes(s.slotId) && s.monster && matches(s.monster, effect.filter)).map(s => s.slotId)
          if (selected.length) apply(effect.effects, source, event)
          selected = previous
          break
        }
        case 'stats': {
          const repeats = effect.repeatPerRace ? occupied(state, { race: effect.repeatPerRace }).length : 1
          for (const slot of select(effect.target, event, source)) {
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
          if (event?.type === 'addSucceeded' && observations.mutatedAdditionSlotIds?.[source]) {
            if (observations.mutatedAdditionSlotIds[source]!.includes(event.slotId!)) apply(effect.effects, source, event)
          } else if (chance(effect.probability, random)) apply(effect.effects, source, event)
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
            if (before.race !== race || before.rarity !== rarity || effect.randomIdentity || before.monsterId === cocoonId)
              m.monsterId = afterId === cocoonId ? `class:${race}:${rarity}` : afterId ?? `class:${race}:${rarity}`
            m.unitActivity += effect.activityBonus ?? 0
            if (before.race !== race || before.rarity !== rarity || before.monsterId === cocoonId || (effect.randomIdentity && before.monsterId !== m.monsterId))
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
        case 'pupaGrowth': {
          const x = occupied(state, { race: 'swarm' }).length
          const repetitions = x + (model.pupaRepetitions === 'additionalX' ? 1 : 0)
          warnings.add(`人蛹重复解释：${model.pupaRepetitions === 'additionalX' ? '首次后额外X次' : '总计X次'}；每次随机X个不同目标，跨次可重复`)
          for (let i = 0; i < repetitions; i++) {
            for (const target of pick(combinations(occupied(state), x), random)) target.monster!.quantity += 8
          }
          break
        }
        case 'devour': {
          // Freeze the victim before transfer; exclude it from recipient tie-breaking.
          const victim = select(effect.victim, event)[0]
          if (!victim) break
          const value = { ...victim.monster! }
          const candidates = effect.recipient.mode === 'random' || effect.recipient.mode === 'highest'
            ? occupied(state, effect.recipient.filter).filter(s => s !== victim) : []
          if (!candidates.length) break
          const maximum = Math.max(...candidates.map(s => s.monster!.quantity * s.monster!.unitActivity))
          const recipient = pick(effect.recipient.mode === 'highest'
            ? candidates.filter(s => s.monster!.quantity * s.monster!.unitActivity === maximum) : candidates, random)
          remove(victim, source)
          recipient.monster!.quantity += value.quantity
          recipient.monster!.unitActivity += value.unitActivity
          warnings.add('吞噬按数量与单体活性分别求和；保留接收者身份且不生成添加事件，待实战校准')
          break
        }
        case 'fuseMatching': {
          do {
            const candidates = combinations(occupied(state, effect.filter), effect.count)
              .filter(group => !effect.sameRarity || new Set(group.map(s => s.monster!.rarity)).size === 1)
            if (!candidates.length) break
            const targets = pick(candidates, random)
            const monsters = targets.map(s => ({ ...s.monster! }))
            const rarity = effect.rarity ?? rarityIds[Math.min(3,
              rarityIds.indexOf(monsters[0].rarity) + (effect.upgradeSteps ?? 0))]
            const pool = model.monsters.filter(m => m.rarity === rarity && (!effect.race || m.race === effect.race))
            if (!effect.race && !pool.length)
              throw new ModelUnavailableError('融合结果种群需要目标稀有度怪物字典：' + source)
            const race = effect.race ?? pick([...new Set(pool.map(m => m.race))], random)
            const identityPool = pool.filter(m => m.race === race)
            const identity = identityPool.length ? pick(identityPool, random).monsterId : `unresolved:fusion:${race}:${rarity}`
            targets.forEach(s => remove(s, source))
            add({ base: { monsterId: identity, race, rarity,
              quantity: monsters.reduce((n, m) => n + m.quantity, 0),
              unitActivity: monsters.reduce((n, m) => n + m.unitActivity, 0) } }, source)
            emit({ type: 'fusionCompleted', source })
            warnings.add('融合按数量与单体活性求和，升阶不额外套用变异属性模型；连续融合先完成本器械效果再处理事件链')
          } while (effect.repeat)
          break
        }
        case 'upgradeEachRarity': {
          // Snapshot targets before any promotion; never promote one group twice.
          const targets = rarityIds.filter(r => r !== 'boss').flatMap(r => {
            const pool = occupied(state, { rarities: [r] })
            return pool.length ? [pick(pool, random).slotId] : []
          })
          const previous = selected
          selected = targets
          apply([{ type: 'mutate', target: { mode: 'selected' }, upgradeSteps: 1 }], source, event)
          selected = previous
          break
        }
        case 'randomizeAll': {
          const previous = selected
          for (const slot of occupied(state)) {
            const pool = model.monsters.filter(m => slot.monster!.rarity !== 'boss' || m.rarity === 'boss')
            if (!pool.length) throw new ModelUnavailableError('随机变异需要完整合法怪物字典：' + source)
            const race = pick([...new Set(pool.map(m => m.race))], random)
            const racePool = pool.filter(m => m.race === race)
            const rarity = pick([...new Set(racePool.map(m => m.rarity))], random)
            selected = [slot.slotId]
            apply([{ type: 'mutate', target: { mode: 'selected' }, race, rarity, randomIdentity: true }], source, event)
          }
          selected = previous
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
  if (!action) {
    if (potion) {
      selected = potion.card.targeting?.mode === 'random'
        ? pick(targetCombinations(state, potion.card.targeting), random) : potion.targets
      emit({ type: 'cardPlayed', source: potion.card.id })
      apply(potion.card.effects, potion.card.id)
      state.specialOffer = potion.card.specialOffer && structuredClone(potion.card.specialOffer)
      if (state.specialOffer) warnings.add(`下一轮${state.specialOffer.mode === 'additional' ? '普通候选保留，额外' : '替换普通候选，'}发放${state.specialOffer.count}支特殊药剂；未选择延续卡则中断。${state.specialOffer.likelyCardName ? `高概率倾向：${state.specialOffer.likelyCardName}，具体概率未知。` : ''}此后续价值不计入本轮评分。`)
      drain()
      if (potion.includeRoundEnd) { emit({ type: 'roundEnd', source: 'round' }); drain() }
    }
    for (const event of initialEvents) {
      if (event.type === 'roundEnd') drain()
      emit(event)
    }
    drain()
  } else if (action.type === 'redraw') {
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
      state.specialOffer = card.specialOffer && structuredClone(card.specialOffer)
      if (card.acquirePersistentId) state.persistentEffects.push({
        cardId: card.acquirePersistentId, acquiredRound: state.round, firstEligibleRound: state.round + 1,
        triggerCount: 0, enabled: true,
      })
      if (card.nextStage !== undefined) state.specialPotionStage = card.nextStage
    }
    drain()
    emit({ type: 'roundEnd', source: 'round' }); drain()
    state.round++
    if (state.round > 10) delete state.specialOffer
    state.offeredCardIds = state.round <= 10 ? drawOffer(state, model, random) : []
  }
  validateState(state)
  return { state, events, warnings: [...warnings] }
}
