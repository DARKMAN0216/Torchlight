import { raceLabels, rarityLabels } from '../data/sampleLibrary'
import {
  rarityIds,
  raceIds,
  type CandidateCard,
  type CardEffect,
  type Condition,
  type EvaluationContext,
  type EvaluationResult,
  type GameState,
  type MonsterGroup,
  type PersistentCard,
  type PersistentLoadout,
  type RaceId,
  type RaceSelector,
} from '../types/game'
import { evaluateStrategicState } from './strategy'
import { enumerateTargetSets } from './targeting'
import { persistentCardsIn } from './persistent'
import { projectPotion } from './potionProjection'
import { evaluateConfirmedPotion } from './confirmedPotions'
import { canEvaluateCard } from './cardAvailability'
import { projectPupaScraper } from './pupaScraper'
import { compareStartup, raceRanges, withStartup } from './startup'
import { asPlannerMonster, previewPassives, usesSharedPassives, type PassivePreview } from './sharedPassives'
import type { GameEvent } from '../planner/types'

const futureEmptySlotValue = 12
const baseGroupQuantity = 12
const baseGroupUnitActivity = 15

interface ResolutionRuntime {
  removedGroups: MonsterGroup[]
  addedGroups: MonsterGroup[]
  events: GameEvent[]
  instances: Record<string, string>
  nextInstance: number
}

export interface RoundEndTransitionProjection {
  unavailable?: string
  uncertain?: boolean
  bonus: number
  activityBonus?: number
  analysis: string[]
}

export function cloneState(state: GameState): GameState {
  return { ...state, monsters: state.monsters.map((monster) => ({ ...monster })) }
}

export function totalActivity(state: GameState): number {
  return state.monsters.reduce(
    (sum, monster) => sum + (monster.race ? monster.quantity * monster.unitActivity : 0),
    0,
  )
}

export function groupTotalActivity(monster: MonsterGroup): number {
  return monster.quantity * monster.unitActivity
}

function activeGroups(state: GameState): MonsterGroup[] {
  return state.monsters.filter((monster) => monster.race !== null && monster.quantity > 0)
}

function activeRaceIds(state: GameState): RaceId[] {
  return [...new Set(activeGroups(state).map((monster) => monster.race as RaceId))]
}

function resolveGroup(
  state: GameState,
  selector: RaceSelector,
  context: EvaluationContext,
  excludedId?: string,
): MonsterGroup | undefined {
  const available = activeGroups(state).filter((monster) => monster.id !== excludedId)
  const candidates = selector === 'selected'
    ? available.filter((monster) => context.selectedMonsterIds?.includes(monster.id))
    : raceIds.includes(selector as RaceId)
      ? available.filter((monster) => monster.race === selector)
      : available

  if (candidates.length === 0) return undefined
  if (selector === 'lowestActivity') {
    return candidates.reduce((lowest, current) =>
      groupTotalActivity(current) < groupTotalActivity(lowest) ? current : lowest,
    )
  }
  if (selector === 'lowestQuantity') {
    return candidates.reduce((lowest, current) =>
      current.quantity < lowest.quantity ? current : lowest,
    )
  }
  return candidates.reduce((highest, current) =>
    groupTotalActivity(current) > groupTotalActivity(highest) ? current : highest,
  )
}

function resolveGroups(
  state: GameState,
  selector: RaceSelector,
  context: EvaluationContext,
  allMatches = false,
): MonsterGroup[] {
  if (selector === 'selected') {
    return activeGroups(state).filter((monster) => context.selectedMonsterIds?.includes(monster.id))
  }
  if (allMatches && selector === 'all') return activeGroups(state)
  if (allMatches && raceIds.includes(selector as RaceId)) {
    return activeGroups(state).filter((monster) => monster.race === selector)
  }
  const target = resolveGroup(state, selector, context)
  return target ? [target] : []
}

function conditionMatches(state: GameState, condition?: Condition): boolean {
  if (!condition) return true
  if (condition.type === 'singleRace') return activeRaceIds(state).length === 1
  if (condition.type === 'minRarityGroups') {
    return activeGroups(state).filter((monster) => monster.rarity === condition.rarity).length >= condition.value
  }
  if (condition.type === 'minRaceRarityGroups') {
    return activeGroups(state).filter((monster) =>
      monster.race === condition.target && condition.rarities.includes(monster.rarity),
    ).length >= condition.value
  }
  const matching = activeGroups(state).filter((monster) => monster.race === condition.target)
  if (condition.type === 'minRaceGroups') return matching.length >= condition.value
  if (condition.type === 'minQuantity') {
    return matching.some((monster) => monster.quantity >= condition.value)
  }
  return matching.some((monster) => monster.unitActivity >= condition.value)
}

function gainMultiplier(persistent: PersistentLoadout, race: RaceId): number {
  return persistentCardsIn(persistent).reduce(
    (multiplier, card) => multiplier *
      (card.globalGainMultiplier ?? 1) *
      (card.targetGainMultiplier?.[race] ?? 1),
    1,
  )
}

function clearGroup(group: MonsterGroup): void {
  delete group.specialIdentity
  group.race = null
  group.rarity = 'common'
  group.quantity = 0
  group.unitActivity = 0
}

function noTarget(trace: string[], warnings: string[], selector: RaceSelector): void {
  if (selector === 'selected') {
    trace.push('尚未选择怪物目标，等待勾选后结算')
    warnings.push('需要先勾选怪物目标')
    return
  }
  trace.push(`没有符合“${selector}”条件的怪物组，跳过效果`)
}

function addGroupToFirstEmptySlot(
  state: GameState,
  race: RaceId,
  rarity: MonsterGroup['rarity'],
  quantity: number,
  unitActivity: number,
  persistent: PersistentLoadout,
  trace: string[],
  warnings: string[],
  base?: GameState['newbornSwarm'],
): MonsterGroup | undefined {
  const target = state.monsters.find((monster) => monster.race === null)
  if (!target) {
    const message = `培养皿已满，未能添加${raceLabels[race]}`
    trace.push(message)
    warnings.push(message)
    return undefined
  }
  const activityGain = Math.round(unitActivity * gainMultiplier(persistent, race))
  target.race = race
  target.rarity = rarity
  target.quantity = (base?.quantity ?? baseGroupQuantity) + quantity
  target.unitActivity = (base?.unitActivity ?? baseGroupUnitActivity) + activityGain
  trace.push(
    `在${target.id.replace('slot-', '槽位 ')}添加${rarityLabels[rarity]}` +
      `${raceLabels[race]}：基础 ${base?.unitActivity ?? baseGroupUnitActivity} × ${base?.quantity ?? baseGroupQuantity}` +
      `，额外 +${quantity} 数量、+${activityGain} 单体活性` +
      `，组总活性 ${target.quantity * target.unitActivity}`,
  )
  return { ...target }
}

function applyEffectBody(
  state: GameState,
  effect: CardEffect,
  persistent: PersistentLoadout,
  trace: string[],
  warnings: string[],
  context: EvaluationContext,
  runtime: ResolutionRuntime,
): void {
  if (!conditionMatches(state, effect.condition)) {
    trace.push('条件未满足，跳过一条效果')
    return
  }

  if (effect.type === 'withTargets') {
    for (const nested of effect.effects) applyEffect(state, nested, persistent, trace, warnings,
      { ...context, selectedMonsterIds: effect.ids }, runtime)
    return
  }

  if (effect.type === 'addActivity') {
    const targets = resolveGroups(state, effect.target, context, effect.allMatches).filter(
      (target) => effect.minQuantityExclusive === undefined ||
        target.quantity > effect.minQuantityExclusive,
    )
    if (targets.length === 0) return noTarget(trace, warnings, effect.target)
    for (const target of targets) {
      if (!target.race) continue
      const repetitions = effect.repeatOnlyRace && target.race !== effect.repeatOnlyRace
        ? 1
        : (effect.repeatByRarity?.[target.rarity] ?? 1) *
          (effect.repeatPerRaceGroup
            ? activeGroups(state).filter((group) => group.race === effect.repeatPerRaceGroup).length
            : 1)
      const gain = Math.round(
        effect.amount * repetitions * gainMultiplier(persistent, target.race),
      )
      target.unitActivity += gain
      trace.push(
        `${raceLabels[target.race]}（${target.id.replace('slot-', '槽位 ')}）` +
          `+${gain} 单体活性` +
          (repetitions > 1 ? `（生效 ${repetitions} 次）` : '') +
          `，总活性 +${gain * target.quantity}`,
      )
    }
    return
  }

  if (effect.type === 'addQuantity') {
    const targets = resolveGroups(state, effect.target, context, effect.allMatches)
    if (targets.length === 0) return noTarget(trace, warnings, effect.target)
    for (const target of targets) {
      if (!target.race) continue
      target.quantity = Math.max(0, target.quantity + effect.amount)
      const activityGain = Math.round(
        (effect.activityPerNewUnit ?? 0) * gainMultiplier(persistent, target.race),
      )
      if (activityGain) target.unitActivity += activityGain
      trace.push(
        `${raceLabels[target.race]}（${target.id.replace('slot-', '槽位 ')}）数量 ` +
          `${effect.amount >= 0 ? '+' : ''}${effect.amount}` +
          (activityGain ? `，并获得 ${activityGain} 单体活性` : ''),
      )
    }
    return
  }

  if (effect.type === 'multiplyActivity') {
    const target = resolveGroup(state, effect.target, context)
    if (!target?.race) return noTarget(trace, warnings, effect.target)
    target.unitActivity = Math.round(target.unitActivity * effect.factor)
    trace.push(`${raceLabels[target.race]}（${target.id.replace('slot-', '槽位 ')}）活性 ×${effect.factor}`)
    return
  }

  if (effect.type === 'removeRace') {
    const target = resolveGroup(state, effect.target, context)
    if (!target?.race) return noTarget(trace, warnings, effect.target)
    const removedRace = target.race
    const removed = { ...target }
    if (effect.transferTo) {
      const transferTarget = resolveGroup(state, effect.transferTo, context, target.id)
      const transferred = Math.round(removed.unitActivity * (effect.transferRate ?? 0))
      if (transferTarget?.race) {
        transferTarget.unitActivity += transferred
        trace.push(
          `移除${raceLabels[removedRace]}（${removed.id.replace('slot-', '槽位 ')}），` +
          `向${raceLabels[transferTarget.race]}转移 ${transferred} 活性`,
        )
      } else {
        trace.push(`移除${raceLabels[removedRace]}，但没有可接收转移的怪物组`)
      }
    } else {
      trace.push(`移除${raceLabels[removedRace]}（${removed.id.replace('slot-', '槽位 ')}）`)
    }
    runtime.removedGroups.push(removed)
    clearGroup(target)
    return
  }

  if (effect.type === 'removeObservedGroups') {
    const ids = context.observedRemovedMonsterIds ?? []
    const uniqueIds = [...new Set(ids)]
    const selected = resolveGroups(state, 'selected', context)
    const targets = uniqueIds
      .map((id) => state.monsters.find((monster) => monster.id === id))
      .filter((monster): monster is MonsterGroup => Boolean(monster?.race))
    const invalidDifferentRace = effect.differentRaceFromSelected && selected.some(
      (primary) => targets.some((target) => target.race === primary.race),
    )
    const overlapsPrimary = targets.some((target) =>
      context.selectedMonsterIds?.includes(target.id),
    )
    const eligibleRemovalCount = state.monsters.filter((monster) =>
      monster.race &&
      !context.selectedMonsterIds?.includes(monster.id) &&
      (!effect.differentRaceFromSelected || !selected.some((primary) => primary.race === monster.race)),
    ).length
    const requiredCount = effect.allowFewerWhenUnavailable
      ? Math.min(effect.count, eligibleRemovalCount)
      : effect.count
    if (
      ids.length !== requiredCount ||
      uniqueIds.length !== requiredCount ||
      targets.length !== requiredCount ||
      invalidDifferentRace ||
      overlapsPrimary
    ) {
      trace.push(`尚未完整记录实际被移除的 ${requiredCount} 组怪物`)
      warnings.push(`需要记录实际被移除的 ${requiredCount} 组怪物`)
      return
    }
    for (const target of targets) {
      const removed = { ...target }
      runtime.removedGroups.push(removed)
      trace.push(`记录移除${raceLabels[removed.race!]}（${removed.id.replace('slot-', '槽位 ')}）`)
      clearGroup(target)
    }
    return
  }

  if (effect.type === 'removeLeftOfSelected' || effect.type === 'removeRightOfSelected') {
    const right = effect.type === 'removeRightOfSelected'
    const side = right ? '右侧' : '左侧'
    const selectedId = context.selectedMonsterIds?.[0]
    const selectedIndex = state.monsters.findIndex((monster) => monster.id === selectedId)
    if (selectedIndex < 0) return noTarget(trace, warnings, 'selected')
    const neighborIndex = selectedIndex + (right ? 1 : -1)
    if (neighborIndex < 0 || neighborIndex >= state.monsters.length) {
      trace.push(`所选怪物${side}没有培养皿，不移除怪物`)
      return
    }
    const target = state.monsters[neighborIndex]
    if (!target.race) {
      trace.push(`${target.id.replace('slot-', '槽位 ')}为空，${side}移除未产生损失`)
      return
    }
    const removed = { ...target }
    runtime.removedGroups.push(removed)
    trace.push(`移除所选怪物${side}的${raceLabels[removed.race!]}（${removed.id.replace('slot-', '槽位 ')}）`)
    clearGroup(target)
    return
  }

  if (effect.type === 'upgradeRarity') {
    const targets = resolveGroups(state, effect.target, context, effect.allMatches)
    if (targets.length === 0) return noTarget(trace, warnings, effect.target)
    for (const target of targets) {
      if (target.rarity === 'boss') {
        const message = `${target.id.replace('slot-', '槽位 ')}已是首领，稀有度升阶不生效`
        trace.push(message)
        warnings.push(message)
        continue
      }
      const currentIndex = rarityIds.indexOf(target.rarity)
      const nextIndex = Math.min(rarityIds.length - 1, currentIndex + effect.steps)
      const previous = target.rarity
      target.rarity = rarityIds[nextIndex]
      trace.push(
        `${target.id.replace('slot-', '槽位 ')}稀有度：${rarityLabels[previous]} → ${rarityLabels[target.rarity]}`,
      )
    }
    return
  }

  if (effect.type === 'setRarity') {
    const resolvedTargets = resolveGroups(state, effect.target, context, effect.allMatches)
    if (resolvedTargets.length === 0) return noTarget(trace, warnings, effect.target)
    const targets = resolvedTargets.filter(
      (target) => !effect.onlyRace || target.race === effect.onlyRace,
    )
    if (targets.length === 0) {
      trace.push('所选怪物的种群不满足稀有度变化条件')
      return
    }
    for (const target of targets) {
      const currentIndex = rarityIds.indexOf(target.rarity)
      const desiredIndex = rarityIds.indexOf(effect.rarity)
      if (
        target.rarity === 'boss' ||
        desiredIndex === currentIndex ||
        (desiredIndex < currentIndex && !effect.allowDowngrade)
      ) {
        const message = `${target.id.replace('slot-', '槽位 ')}当前为${rarityLabels[target.rarity]}，指定为${rarityLabels[effect.rarity]}未改变稀有度`
        trace.push(message)
        if (target.rarity === 'boss') warnings.push(message)
        continue
      }
      const previous = target.rarity
      target.rarity = effect.rarity
      if (effect.activityBonusOnChange && target.race) {
        target.unitActivity += effect.activityBonusOnChange
      }
      trace.push(
        `${target.id.replace('slot-', '槽位 ')}稀有度：${rarityLabels[previous]} → ${rarityLabels[target.rarity]}` +
          (effect.activityBonusOnChange ? `，+${effect.activityBonusOnChange} 单体活性` : ''),
      )
    }
    return
  }

  if (effect.type === 'mergeSelected') {
    const targets = resolveGroups(state, 'selected', context)
    if (targets.length < (effect.minTargets ?? 2)) return noTarget(trace, warnings, 'selected')
    if (
      effect.requireSameRarity &&
      targets.some((target) => target.rarity !== targets[0].rarity)
    ) {
      const message = '所选怪物稀有度不同，融合未生效'
      trace.push(message)
      warnings.push(message)
      return
    }

    const removedGroups = targets.map((target) => ({ ...target }))
    const sourceTemplate = removedGroups[0]
    const previousRarity = sourceTemplate.rarity
    const totalQuantity = targets.reduce((sum, target) => sum + target.quantity, 0)
    const totalUnitActivity = targets.reduce((sum, target) => sum + target.unitActivity, 0)

    for (const target of targets) clearGroup(target)
    const destination = state.monsters.find((monster) => !monster.race)!
    destination.race = effect.outputRace ?? sourceTemplate.race
    destination.rarity = sourceTemplate.rarity
    destination.quantity = totalQuantity
    destination.unitActivity = totalUnitActivity

    if (effect.rarity) {
      const desiredIndex = rarityIds.indexOf(effect.rarity)
      const currentIndex = rarityIds.indexOf(destination.rarity)
      if (desiredIndex > currentIndex) destination.rarity = effect.rarity
    } else if (effect.upgradeSteps && destination.rarity !== 'boss') {
      const currentIndex = rarityIds.indexOf(destination.rarity)
      destination.rarity = rarityIds[
        Math.min(rarityIds.length - 1, currentIndex + effect.upgradeSteps)
      ]
    }

    runtime.removedGroups.push(...removedGroups)
    runtime.addedGroups.push(destination)
    trace.push(
      `${targets.length} 组怪物融合至${destination.id.replace('slot-', '槽位 ')}：` +
        `数量 ${totalQuantity}、单体活性 ${totalUnitActivity}、` +
        `稀有度 ${rarityLabels[previousRarity]} → ${rarityLabels[destination.rarity]}`,
    )
    if (!effect.outputRace) {
      warnings.push('融合后种群暂按最左侧目标保留；若游戏结果不同，请手动修正')
    }
    return
  }

  if (effect.type === 'addObservedGroups') {
    const observedRaces = context.observedNewGroupRaces ?? []
    if (observedRaces.length === 0) {
      trace.push('尚未记录新怪物的实际随机种群，等待人工确认后结算')
      warnings.push('需要先记录新怪物的实际随机种群')
      return
    }
    for (const race of observedRaces) {
      const added = addGroupToFirstEmptySlot(
        state,
        race,
        effect.rarity,
        effect.quantity,
        effect.activity ?? 0,
        persistent,
        trace,
        warnings,
      )
      if (added) runtime.addedGroups.push(added)
    }
    return
  }

  if (effect.type === 'addGroup') {
    for (let index = 0; index < (effect.count ?? 1); index += 1) {
      const added = addGroupToFirstEmptySlot(
        state,
        effect.race,
        effect.rarity ?? 'common',
        effect.quantity ?? 0,
        effect.activity ?? 0,
        persistent,
        trace,
        warnings,
        effect.base,
      )
      if (added) runtime.addedGroups.push(added)
    }
    return
  }

  const targets = resolveGroups(state, effect.target, context, effect.allMatches)
  if (targets.length === 0) return noTarget(trace, warnings, effect.target)
  for (const target of targets) {
    if (!target.race) continue
    const nextRace = effect.to === 'observed'
      ? context.observedRaceByMonsterId?.[target.id]
      : effect.to
    if (!nextRace) {
      const message = `${target.id.replace('slot-', '槽位 ')}尚未记录实际随机种群`
      trace.push(message)
      warnings.push(message)
      continue
    }
    const oldRace = target.race
    if (effect.onlyIfDifferent && oldRace === nextRace) continue
    const beforeMutation = cloneState(state)
    target.race = nextRace
    target.specialIdentity = 'ordinary'
    const persistentConversionBonus = persistentCardsIn(persistent).reduce(
      (sum, item) => sum + (item.conversionBonusPerUnit?.[nextRace] ?? 0),
      0,
    )
    const perUnit = (effect.bonusPerUnit ?? 0) + persistentConversionBonus
    const unitGain = Math.round(perUnit * gainMultiplier(persistent, nextRace))
    const bonus = target.quantity * unitGain
    target.unitActivity += unitGain
    trace.push(
      `${raceLabels[oldRace]}（${target.id.replace('slot-', '槽位 ')}）转化为` +
        `${raceLabels[nextRace]}，额外获得 ${bonus} 活性`,
    )
    if (oldRace !== nextRace) {
      for (const item of persistentCardsIn(persistent).filter(p => !p.sharedRules)) {
        const trigger = item.onMutationActivityBonus
        if (!trigger || (trigger.toRace && trigger.toRace !== nextRace)) continue
        if (trigger.condition) {
          const beforeEligible = conditionMatches(beforeMutation, trigger.condition)
          const afterEligible = conditionMatches(state, trigger.condition)
          if (beforeEligible !== afterEligible) warnings.push(`${item.name}：变异跨越触发门槛，时点待验证，未计入该次收益`)
          if (!beforeEligible || !afterEligible) continue
        }
        for (const group of activeGroups(state)) group.unitActivity += trigger.amount
        trace.push(`${item.name}：变异为${raceLabels[nextRace]}触发，全体 +${trigger.amount} 单体活性`)
      }
    }
  }
}

function applyEffect(
  state: GameState, effect: CardEffect, persistent: PersistentLoadout, trace: string[], warnings: string[],
  context: EvaluationContext, runtime: ResolutionRuntime,
): void {
  const before = cloneState(state)
  const removedOffset = runtime.removedGroups.length
  const addedOffset = runtime.addedGroups.length
  applyEffectBody(state, effect, persistent, trace, warnings, context, runtime)
  if (effect.type === 'withTargets') return // Nested primitive effects already recorded their events.
  const removed = runtime.removedGroups.slice(removedOffset)
  const added = runtime.addedGroups.slice(addedOffset)
  for (const m of removed) runtime.events.push({ type: 'removeSucceeded', source: 'potion', round: state.round,
    slotId: m.id, before: asPlannerMonster(m, runtime.instances[m.id]) })
  for (const m of added) {
    runtime.instances[m.id] = `potion-added-${runtime.nextInstance++}`
    runtime.events.push({ type: 'addSucceeded', source: 'potion', round: state.round,
      slotId: m.id, after: asPlannerMonster(m, runtime.instances[m.id]) })
  }
  if (conditionMatches(before, effect.condition)) {
    const attempts = effect.type === 'addGroup' ? effect.count ?? 1
      : effect.type === 'addObservedGroups' ? context.observedNewGroupRaces?.length ?? 0 : 0
    for (let i = added.length; i < attempts; i++) runtime.events.push({
      type: 'addFailedBoardFull', source: 'potion', round: state.round,
    })
  }
  if (effect.type === 'mergeSelected' && added.length) runtime.events.push({ type: 'fusionCompleted', source: 'potion', round: state.round })
  for (const m of activeGroups(state)) {
    const old = before.monsters.find(s => s.id === m.id)
    if (old?.race && !added.some(a => a.id === m.id) && (old.race !== m.race || old.rarity !== m.rarity
      || (old.specialIdentity === 'hollow-cocoon' && m.specialIdentity !== 'hollow-cocoon')))
      runtime.events.push({ type: 'mutationCompleted', source: 'potion', round: state.round, slotId: m.id,
        before: asPlannerMonster(old, runtime.instances[m.id]), after: asPlannerMonster(m, runtime.instances[m.id]) })
  }
}

function applyPersistentRemovalTrigger(
  state: GameState,
  source: GameState,
  card: CandidateCard,
  persistent: PersistentLoadout,
  runtime: ResolutionRuntime,
  context: EvaluationContext,
  trace: string[],
  warnings: string[],
): void {
  const triggerCards = persistentCardsIn(persistent).filter(
    (item) => item.onRemovalQuantityBonus && !item.sharedRules,
  )
  for (const persistentCard of triggerCards) {
    const trigger = persistentCard.onRemovalQuantityBonus!
    if (!conditionMatches(source, trigger.condition)) continue
    if (!conditionMatches(state, trigger.condition)) {
      warnings.push(`${persistentCard.name}：移除跨越常驻门槛，触发时点待验证，暂不计入该条件增量`)
      continue
    }
    const triggerCount = runtime.removedGroups.filter(
      (removed) => !trigger.excludedRace || removed.race !== trigger.excludedRace,
    ).length
    if (triggerCount === 0) continue
    if (!card.resolutionObservation) {
      const activeTargets = activeGroups(state)
      if (activeTargets.length === 1) {
        for (let index = 0; index < triggerCount; index += 1) {
          const target = activeTargets[0]
          target.quantity += trigger.amount
          trace.push(
            `${persistentCard.name}第 ${index + 1} 次触发：当前仅有` +
              `${raceLabels[target.race!]}（${target.id.replace('slot-', '槽位 ')}），` +
              `确定 +${trigger.amount} 数量`,
          )
        }
        continue
      }
      const message = `${card.name}与${persistentCard.name}的随机移除连锁需要记录实际目标，请在结算后手动校正局面`
      trace.push(message)
      warnings.push(message)
      continue
    }

    const targetIds = context.observedPersistentTriggerTargetIdsByCardId?.[persistentCard.id]
      ?? (triggerCards.length === 1 ? context.observedPersistentTriggerTargetIds : undefined)
      ?? []
    const targets = targetIds.map((id) =>
      state.monsters.find((monster) => monster.id === id && monster.race !== null),
    )
    if (targetIds.length !== triggerCount || targets.some((target) => !target)) {
      trace.push(`${persistentCard.name}触发 ${triggerCount} 次，尚未完整记录随机增量目标`)
      warnings.push(`需要记录${persistentCard.name}的 ${triggerCount} 次随机目标`)
      continue
    }

    targets.forEach((target, index) => {
      if (!target?.race) return
      target.quantity += trigger.amount
      trace.push(
        `${persistentCard.name}第 ${index + 1} 次触发：` +
          `${raceLabels[target.race]}（${target.id.replace('slot-', '槽位 ')}）` +
          `+${trigger.amount} 数量`,
      )
    })
  }
}

function expectedOnAddAdjustment(
  state: GameState,
  runtime: ResolutionRuntime,
  persistent: PersistentLoadout,
  context: EvaluationContext,
): { bonus: number; analysis: string[]; warning?: string } {
  if (runtime.addedGroups.length === 0) return { bonus: 0, analysis: [] }
  const mutationCards = persistentCardsIn(persistent).filter(
    (card) => card.onAddGroupExpectedMutation && !card.sharedRules,
  )
  if (mutationCards.length === 0) return { bonus: 0, analysis: [] }

  let bonus = 0
  const analysis: string[] = []
  let expectedMutationEvents = 0
  let observedMutationEvents = 0
  for (const card of mutationCards) {
    const mutation = card.onAddGroupExpectedMutation!
    const observations = context.observedAddedGroupMutationIdsByCardId
    const hasObservation = Boolean(
      observations && Object.prototype.hasOwnProperty.call(observations, card.id),
    )
    if (hasObservation) {
      const successfulIds = new Set(observations?.[card.id] ?? [])
      for (const group of runtime.addedGroups) {
        if (successfulIds.has(group.id)) {
          group.race = mutation.toRace
          group.unitActivity += mutation.unitActivityBonus
          const actual = state.monsters.find(monster => monster.id === group.id)
          if (actual) { actual.race = group.race; actual.unitActivity = group.unitActivity; actual.specialIdentity = 'ordinary' }
          observedMutationEvents += 1
          analysis.push(
            `${card.name}实际触发：${group.id.replace('slot-', '槽位 ')}变异为` +
              `${raceLabels[mutation.toRace]}并 +${mutation.unitActivityBonus} 单体活性`,
          )
        } else {
          analysis.push(`${card.name}实际未触发：${group.id.replace('slot-', '槽位 ')}`)
        }
      }
      continue
    }
    expectedMutationEvents += runtime.addedGroups.length * mutation.probability
    const cardBonus = runtime.addedGroups.reduce(
      (sum, group) => sum + group.quantity * mutation.unitActivityBonus * mutation.probability,
      0,
    )
    bonus += cardBonus
    analysis.push(
      `${card.name}：${runtime.addedGroups.length} 组新增怪物按 ` +
        `${Math.round(mutation.probability * 100)}% 触发率估算，期望活性 +${Math.round(cardBonus)}`,
    )
  }
  const mutationBonusCards = persistentCardsIn(persistent).filter(
    (card) => card.onMutationActivityBonus && !card.sharedRules,
  )
  for (const card of mutationBonusCards) {
    const mutationBonus = card.onMutationActivityBonus!
    if (mutationBonus.condition) {
      analysis.push(`${card.name}：新增怪物连锁变异的条件时点待验证，暂不计入该连锁收益`)
      continue
    }
    const matchingObservedEvents = runtime.addedGroups.filter(
      (group) => group.race === mutationBonus.toRace,
    ).length
    const observedEvents = observedMutationEvents > 0 ? matchingObservedEvents : 0
    if (observedEvents > 0) {
      for (const group of activeGroups(state)) {
        group.unitActivity += mutationBonus.amount * observedEvents
      }
      analysis.push(
        `${card.name}实际触发 ${observedEvents} 次：所有怪物各 +` +
          `${mutationBonus.amount * observedEvents} 单体活性`,
      )
    } else if (expectedMutationEvents > 0) {
      const expectedBonus = activeGroups(state).reduce(
        (sum, group) => sum + group.quantity * mutationBonus.amount * expectedMutationEvents,
      0)
      bonus += expectedBonus
      analysis.push(
        `${card.name}：按 ${Math.round(expectedMutationEvents * 100) / 100} 次预期异魔变异，` +
          `估算全体活性 +${Math.round(expectedBonus)}`,
      )
    }
  }
  return {
    bonus: Math.round(bonus),
    analysis,
    warning: '新增怪物的常驻变异是概率事件；应用卡牌后请按游戏实际结果修正种群与活性',
  }
}

function evaluateCardInternal(
  source: GameState,
  card: CandidateCard,
  persistent: PersistentLoadout,
  context: EvaluationContext = {},
  includeRoundEndProjection = true,
): EvaluationResult {
  if (card.evaluationUnavailable) throw new Error(`${card.name}尚未量化，不能把未知效果作为零收益结算`)
  if (card.confirmedPotion) return evaluateConfirmedPotion(source, card, persistent, context)
  if (!canEvaluateCard(source, card)) throw new Error(`${card.name}需要先确认新增蛊虫的基础参数`)
  if (card.projection) return projectPotion(source, card, persistent, context,
    (variant, observed) => evaluateCardInternal(source, variant, persistent, observed, includeRoundEndProjection))
  let state = cloneState(source)
  const before = totalActivity(state)
  const trace: string[] = []
  const warnings: string[] = []
  if (card.modelWarning) trace.push(`模型边界：${card.modelWarning}`)
  const runtime: ResolutionRuntime = { removedGroups: [], addedGroups: [], events: [], instances: {}, nextInstance: 0 }

  for (const effect of card.effects) {
    applyEffect(state, effect, persistent, trace, warnings, context, runtime)
  }
  applyPersistentRemovalTrigger(state, source, card, persistent, runtime, context, trace, warnings)
  const rawAfterCard = state
  const passiveEvents = previewPassives(state, persistent, runtime.events, runtime.instances, context)
  let eventUncertain = Boolean(passiveEvents.unavailable)
  if (runtime.events.length && usesSharedPassives(persistent)) {
    const unique = new Set(passiveEvents.outcomes.map(o => stateSignature(o.state)))
    eventUncertain ||= !passiveEvents.exhaustive || unique.size !== 1
    warnings.push(...passiveEvents.warnings)
    if (passiveEvents.exhaustive && passiveEvents.outcomes.length) {
      state = cloneState(rawAfterCard)
      // Keep separately proven fields (e.g. claw quantity) even when spinal mutation is random.
      for (const group of state.monsters) {
        const variants = passiveEvents.outcomes.map(o => o.state.monsters.find(m => m.id === group.id))
        if (variants.some(v => !v) || new Set(variants.map(v => Boolean(v!.race))).size !== 1) continue
        for (const field of ['race', 'rarity', 'quantity', 'unitActivity'] as const) {
          if (new Set(variants.map(v => v![field])).size === 1) Object.assign(group, { [field]: variants[0]![field] })
        }
      }
      trace.push(`常驻事件链结算（${persistentCardsIn(persistent).filter(p => p.sharedRules).map(p => p.name).join('、')}）：已确定活性 ${totalActivity(rawAfterCard)} → ${totalActivity(state)}`)
    }
    if (eventUncertain) warnings.push('常驻事件是概率事件，预测仅参与参考评分，实际局面等待 F8 同步')
  }

  for (const persistentCard of persistentCardsIn(persistent)) {
    if (persistentCard.singleRaceFinalMultiplier && activeRaceIds(state).length === 1) {
      for (const target of activeGroups(state)) {
        target.unitActivity = Math.round(
          target.unitActivity * persistentCard.singleRaceFinalMultiplier,
        )
      }
      trace.push(`${persistentCard.name}触发：唯一种群的所有怪物组活性 ×${persistentCard.singleRaceFinalMultiplier}`)
    }
  }

  const expectedOnAdd = expectedOnAddAdjustment(state, runtime, persistent, context)
  trace.push(...expectedOnAdd.analysis)
  if (expectedOnAdd.warning) warnings.push(expectedOnAdd.warning)

  for (const original of activeGroups(source)) {
    const current = state.monsters.find((monster) => monster.id === original.id)
    if (!current?.race) warnings.push(`${original.id.replace('slot-', '槽位 ')}被清空`)
  }

  const after = totalActivity(state)
  const uniqueWarnings = [...new Set(warnings)]
  const eliminated = uniqueWarnings.filter((warning) => warning.endsWith('被清空')).length
  const remainingGroups = activeGroups(state).length
  const preserveScore = after + remainingGroups * 12 - eliminated * 30
  const preserveBefore = before + activeGroups(source).length * 12
  const strategicBefore = evaluateStrategicState(source, persistent)
  const strategicAfter = evaluateStrategicState(state, persistent)
  const transitionBefore = includeRoundEndProjection
    ? evaluateRoundEndTransition(source, persistent)
    : { bonus: 0, analysis: [] }
  const transitionAfter = includeRoundEndProjection
    ? eventUncertain && usesSharedPassives(persistent)
      ? sharedProjection(state, persistent, previewPassives(rawAfterCard, persistent,
          [...runtime.events, { type: 'roundEnd', source: 'round', round: state.round }], runtime.instances, context))
      : evaluateRoundEndTransition(state, persistent)
    : { bonus: 0, analysis: [] }
  const beforeBonus = transitionBefore.activityBonus ?? 0
  const afterBonus = transitionAfter.activityBonus ?? 0
  const hasSettlement = includeRoundEndProjection && persistentCardsIn(persistent)
    .some(item => item.sharedRules || item.roundEndEffect || item.roundEndQuantityPerRaceGroup)
  const unavailable = passiveEvents.unavailable || transitionBefore.unavailable || transitionAfter.unavailable
  const settlementDetails = hasSettlement ? [
    `常驻本轮结算：保留局面 ${beforeBonus >= 0 ? '+' : ''}${beforeBonus} → 选牌后 ${afterBonus >= 0 ? '+' : ''}${afterBonus}，变化 ${afterBonus - beforeBonus >= 0 ? '+' : ''}${afterBonus - beforeBonus}`,
    ...transitionAfter.analysis,
    '仅预览本轮结束，不预测未来发牌；即时局面不重复写入常驻结算。',
  ] : []
  const score = source.mode === 'activity'
    ? after + afterBonus + expectedOnAdd.bonus
    : source.mode === 'preserve'
      ? preserveScore + afterBonus + expectedOnAdd.bonus
      : strategicAfter.value + transitionAfter.bonus + expectedOnAdd.bonus
  const scoreBefore = source.mode === 'activity'
    ? before + beforeBonus
    : source.mode === 'preserve'
      ? preserveBefore + beforeBonus
      : strategicBefore.value + transitionBefore.bonus
  const scoreLabel = source.mode === 'activity'
    ? hasSettlement ? '本轮结算活性' : '即时活性'
    : source.mode === 'preserve'
      ? '阵容评分'
      : '战略评分'

  return {
    ...(unavailable ? { modelUnavailable: unavailable } : {}),
    ...(eventUncertain ? { requiresOutcomeSync: true } : {}),
    card,
    state,
    activityBefore: before,
    activityAfter: after,
    delta: after - before,
    score,
    scoreDelta: score - scoreBefore,
    scoreLabel,
    ...(hasSettlement ? { settlement: {
      ...(unavailable ? { unavailable } : {}),
      uncertain: persistentCardsIn(persistent).some(item =>
        item.roundEndQuantityPerRaceGroup || item.roundEndEffect?.targeting?.mode === 'observedRandom' ||
        item.onAddGroupExpectedMutation || item.onRemovalQuantityBonus) ||
        persistentCardsIn(persistent).filter(item => item.roundEndEffect).length > 1 || eventUncertain || Boolean(unavailable) || Boolean(transitionAfter.uncertain),
      beforeBonus, afterBonus, change: afterBonus - beforeBonus,
      projectedActivity: after + afterBonus,
      details: settlementDetails,
    } } : {}),
    analysis: source.mode === 'strategic'
      ? [
          `战略评分 ${scoreBefore} → ${score}`,
          ...strategicAfter.analysis,
          ...settlementDetails,
          ...expectedOnAdd.analysis,
        ]
      : [...settlementDetails, ...expectedOnAdd.analysis],
    trace,
    warnings: uniqueWarnings,
  }
}

export function evaluateCard(
  source: GameState,
  card: CandidateCard,
  persistent: PersistentLoadout,
  context: EvaluationContext = {},
): EvaluationResult {
  return evaluateCardInternal(source, card, persistent, context)
}

interface RoundEndOutcome {
  state: GameState
  pathCount: number
  warnings: string[]
}

function roundEndCardFor(persistent: PersistentCard): CandidateCard | undefined {
  const effect = persistent.roundEndEffect
  if (!effect) return undefined
  return {
    id: `round-end-projection:${persistent.id}`,
    name: `${persistent.name}·回合结束投射`,
    rarity: 3,
    description: effect.description,
    tags: ['常驻卡', '回合结束', '战略投射'],
    effects: effect.effects,
    targeting: effect.targeting,
  }
}

function stateSignature(state: GameState): string {
  return state.monsters
    .map((monster) => [
      monster.id,
      monster.race ?? '-',
      monster.rarity,
      monster.quantity,
      monster.unitActivity,
    ].join(':'))
    .join('|')
}

function terminalRoundEndOutcomes(
  state: GameState,
  persistent: PersistentCard,
  card: CandidateCard,
  loadout: PersistentLoadout,
  depth = 0,
): RoundEndOutcome[] {
  const effect = persistent.roundEndEffect
  if (!effect || depth >= state.monsters.length) return []

  const targetSets = effect.targeting
    ? enumerateTargetSets(state, effect.targeting)
    : [[]]
  if (targetSets.length === 0) return []

  const outcomes: RoundEndOutcome[] = []
  for (const targetIds of targetSets) {
    const result = evaluateCardInternal(
      state,
      card,
      loadout,
      { selectedMonsterIds: targetIds },
      false,
    )
    if (stateSignature(result.state) === stateSignature(state)) continue

    if (effect.repeatWhileEligible) {
      const repeated = terminalRoundEndOutcomes(result.state, persistent, card, loadout, depth + 1)
      if (repeated.length > 0) {
        outcomes.push(...repeated.map((outcome) => ({
          state: outcome.state,
          pathCount: outcome.pathCount + 1,
          warnings: [...result.warnings, ...outcome.warnings],
        })))
        continue
      }
    }
    outcomes.push({ state: result.state, pathCount: 1, warnings: result.warnings })
  }

  const unique = new Map<string, RoundEndOutcome>()
  for (const outcome of outcomes) {
    const signature = stateSignature(outcome.state)
    const current = unique.get(signature)
    if (!current || outcome.pathCount > current.pathCount) unique.set(signature, outcome)
  }
  return [...unique.values()]
}

function evaluateSingleRoundEndTransition(
  state: GameState,
  persistent: PersistentCard,
  loadout: PersistentLoadout,
): RoundEndTransitionProjection {
  const quantityRule = persistent.roundEndQuantityPerRaceGroup
  if (quantityRule) {
    const groups = activeGroups(state).filter(group => group.quantity > 0)
    const count = groups.filter(group => group.race === quantityRule.race).length
    if (!count) return { bonus: 0, analysis: [`${persistent.name}：当前没有蛊虫，X=0，回合结束无数量收益`] }
    const activities = groups.map(group => group.unitActivity).sort((a, b) => a - b)
    const minimum = quantityRule.amount * count * activities.slice(0, count).reduce((sum, value) => sum + value, 0)
    const maximum = quantityRule.amount * (count + 1) * activities.slice(-count).reduce((sum, value) => sum + value, 0)
    return { bonus: minimum, activityBonus: minimum, analysis: [`${persistent.name}：X=${count}，回合结束活性范围 +${minimum}–+${maximum}；重复次数与随机分布待验证，按保守下界评分，不写回怪物`] }
  }
  const effect = persistent.roundEndEffect
  if (
    !effect ||
    (effect.everyRounds && state.round % effect.everyRounds !== 0)
  ) {
    return { bonus: 0, analysis: [] }
  }

  const card = roundEndCardFor(persistent)
  if (!card) return { bonus: 0, analysis: [] }
  const outcomes = terminalRoundEndOutcomes(state, persistent, card, loadout)
  if (outcomes.length === 0) return { bonus: 0, analysis: [] }

  const before = evaluateStrategicState(state, loadout)
  const scored = outcomes.map((outcome) => {
    const after = evaluateStrategicState(outcome.state, loadout)
    const freedSlots = Math.max(0, before.groupCount - after.groupCount)
    const slotValue = freedSlots * futureEmptySlotValue
    const rawBonus = after.baseValue - before.baseValue + slotValue
    return {
      ...outcome,
      after,
      freedSlots,
      slotValue,
      bonus: rawBonus,
      activityBonus: totalActivity(outcome.state) - totalActivity(state),
    }
  })
  scored.sort((a, b) => a.bonus - b.bonus)

  const randomTarget = effect.targeting?.mode === 'observedRandom'
  const selected = randomTarget ? scored[0] : scored.at(-1)!
  const minimum = scored[0].bonus
  const maximum = scored.at(-1)!.bonus
  const outcomeDescription = randomTarget
    ? minimum === maximum
      ? `随机目标的 ${scored.length} 种合法结果在当前模型下等价`
      : `随机结果范围 +${minimum}–+${maximum}，概率未确认，按保守下界计入`
    : `已比较 ${scored.length} 种合法结算结果`
  const repeatedDescription = selected.pathCount > 1
    ? `，包含 ${selected.pathCount} 次连续触发`
    : ''

  return {
    bonus: selected.bonus,
    // Activity modes must never count rarity/slot heuristic points as activity.
    activityBonus: randomTarget
      ? Math.min(...scored.map(outcome => outcome.activityBonus))
      : Math.max(...scored.map(outcome => outcome.activityBonus)),
    analysis: [
      `回合结束转移收益 ${selected.bonus >= 0 ? '+' : ''}${selected.bonus}（${persistent.name}；${outcomeDescription}${repeatedDescription}）`,
      `转移结构：基础状态 ${before.baseValue} → ${selected.after.baseValue}` +
        (selected.freedSlots > 0
          ? `，释放 ${selected.freedSlots} 个槽位，期权价值 +${selected.slotValue}`
          : ''),
      ...[...new Set(outcomes.flatMap(outcome => outcome.warnings))]
        .filter(warning => !warning.endsWith('被清空')),
    ],
  }
}

export function evaluateRoundEndTransition(
  state: GameState,
  persistent: PersistentLoadout,
): RoundEndTransitionProjection {
  if (usesSharedPassives(persistent)) return sharedProjection(state, persistent, previewPassives(state, persistent,
    [{ type: 'roundEnd', source: 'round', round: state.round }]))
  const roundEndCards = persistentCardsIn(persistent)
    .filter((card) => card.roundEndEffect || card.roundEndQuantityPerRaceGroup)
  // This pair has a bounded, fully enumerated interaction. Other combinations
  // keep their explicit independent-projection caveat until their order is known.
  if (roundEndCards.length === 2 && persistentCardsIn(persistent).length === 2) {
    const pupa = roundEndCards.find(card => card.id === 'human-pupa')
    const scraper = roundEndCards.find(card => card.id === 'dirty-bone-scraper')
    if (pupa && scraper) {
      const combined = projectPupaScraper(state, pupa, scraper)
      if (combined) return combined
    }
  }
  const projections = roundEndCards
    .map((card) => evaluateSingleRoundEndTransition(state, card, persistent))
  return {
    bonus: projections.reduce((sum, projection) => sum + projection.bonus, 0),
    ...(projections.some(item => item.activityBonus !== undefined)
      ? { activityBonus: projections.reduce((sum, item) => sum + (item.activityBonus ?? 0), 0) } : {}),
    analysis: [
      ...projections.flatMap((projection) => projection.analysis),
      ...(roundEndCards.length > 1 ? ['模型边界：多张回合结束常驻暂按同一选牌后局面独立投射，触发顺序及相互连锁尚未量化；以上不是完整组合期望。'] : []),
    ],
  }
}

function sharedProjection(state: GameState, loadout: PersistentLoadout, preview: PassivePreview): RoundEndTransitionProjection {
  if (preview.unavailable) return { bonus: 0, activityBonus: 0, unavailable: preview.unavailable, uncertain: true,
    analysis: [`常驻结算待补数据：${preview.unavailable}；零占位值不代表真实零收益，暂停完整推荐`] }
  const before = evaluateStrategicState(state, loadout)
  const values = preview.outcomes.map(o => {
    const after = evaluateStrategicState(o.state, loadout)
    return { activity: totalActivity(o.state) - totalActivity(state),
      bonus: after.baseValue - before.baseValue + Math.max(0, before.groupCount - after.groupCount) * futureEmptySlotValue }
  })
  const activityBonus = Math.min(...values.map(v => v.activity))
  const maximum = Math.max(...values.map(v => v.activity))
  return { bonus: Math.min(...values.map(v => v.bonus)), activityBonus,
    uncertain: !preview.exhaustive || maximum !== activityBonus,
    analysis: [`回合结束转移收益 ${activityBonus >= 0 ? '+' : ''}${activityBonus}（${persistentCardsIn(loadout).filter(p => p.sharedRules).map(p => p.name).join('、')}）`,
      `常驻事件链：${preview.exhaustive ? '枚举' : '抽样'} ${values.length} 个结果，活性变化 ${activityBonus}–${maximum}`,
      ...preview.warnings] }
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]]
  if (count > items.length) return []
  const output: T[][] = []
  const walk = (start: number, current: T[]) => {
    if (current.length === count) {
      output.push([...current])
      return
    }
    for (let index = start; index <= items.length - (count - current.length); index += 1) {
      current.push(items[index])
      walk(index + 1, current)
      current.pop()
    }
  }
  walk(0, [])
  return output
}

function sequencesWithReplacement<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]]
  if (items.length === 0) return []
  const tails = sequencesWithReplacement(items, count - 1)
  return items.flatMap((item) => tails.map((tail) => [item, ...tail]))
}

function evaluateObservedResolution(
  state: GameState,
  card: CandidateCard,
  persistent: PersistentLoadout,
  context: EvaluationContext,
  targetIds: string[],
): EvaluationResult {
  const removal = card.resolutionObservation?.removals
  if (!removal || context.observedRemovedMonsterIds?.length) {
    return evaluateCard(state, card, persistent, { ...context, selectedMonsterIds: targetIds })
  }

  const primaryRaces = new Set(
    state.monsters
      .filter((monster) => targetIds.includes(monster.id) && monster.race)
      .map((monster) => monster.race),
  )
  const removalCandidates = state.monsters.filter((monster) =>
    monster.race &&
    !targetIds.includes(monster.id) &&
    (!removal.differentRaceFromPrimaryTarget || !primaryRaces.has(monster.race)),
  )
  const requiredRemovalCount = removal.allowFewerWhenUnavailable
    ? Math.min(removal.count, removalCandidates.length)
    : removal.count
  const outcomes: EvaluationResult[] = []
  for (const removed of combinations(removalCandidates, requiredRemovalCount)) {
    const removedIds = removed.map((monster) => monster.id)
    const remainingIds = state.monsters
      .filter((monster) => monster.race && !removedIds.includes(monster.id))
      .map((monster) => monster.id)
    const triggerCards = persistentCardsIn(persistent).filter(
      (item) => item.onRemovalQuantityBonus && conditionMatches(
        state,
        item.onRemovalQuantityBonus.condition,
      ),
    )
    let triggerContexts: EvaluationContext[] = [{}]
    for (const triggerCard of triggerCards) {
      const trigger = triggerCard.onRemovalQuantityBonus!
      const triggerCount = removed.filter(monster => !trigger.excludedRace || monster.race !== trigger.excludedRace).length
      const targets = sequencesWithReplacement(remainingIds, triggerCount)
      if (!targets.length) continue
      triggerContexts = triggerContexts.flatMap(current => targets.map(ids => ({
        observedPersistentTriggerTargetIdsByCardId: {
          ...current.observedPersistentTriggerTargetIdsByCardId, [triggerCard.id]: ids,
        },
      })))
    }
    for (const triggerContext of triggerContexts) {
      outcomes.push(evaluateCard(state, card, persistent, {
        ...context,
        selectedMonsterIds: targetIds,
        observedRemovedMonsterIds: removedIds,
        ...triggerContext,
      }))
    }
  }
  if (outcomes.length === 0) {
    return evaluateCard(state, card, persistent, { ...context, selectedMonsterIds: targetIds })
  }

  outcomes.sort((a, b) => a.score - b.score || a.delta - b.delta)
  const conservative = outcomes[0]
  const minimumActivity = Math.min(...outcomes.map((outcome) => outcome.activityAfter))
  const maximumActivity = Math.max(...outcomes.map((outcome) => outcome.activityAfter))
  const range = minimumActivity === maximumActivity
    ? `所有 ${outcomes.length} 种合法随机结果的活性均为 ${minimumActivity}`
    : `随机结果活性范围 ${minimumActivity}–${maximumActivity}`
  return {
    ...conservative,
    analysis: [
      `${range}，概率未确认，推荐按保守下界计算`,
      ...conservative.analysis,
    ],
  }
}

export function rankCards(
  state: GameState,
  cards: CandidateCard[],
  persistent: PersistentLoadout,
  context: EvaluationContext = {},
): EvaluationResult[] {
  return cards
    .filter((card) => canEvaluateCard(state, card))
    .map((card) => {
      const shouldProjectObservedRandom = Boolean(
        card.rankObservedRandom === 'conservative' &&
        card.targeting?.mode === 'observedRandom' &&
        !context.selectedMonsterIds?.length,
      )
      if (shouldProjectObservedRandom && card.targeting) {
        const targetSets = enumerateTargetSets(state, card.targeting)
        if (targetSets.length > 0) {
          const outcomes = targetSets.map((targetIds) =>
            evaluateCard(state, card, persistent, {
              ...context,
              selectedMonsterIds: targetIds,
            }),
          ).sort((a, b) => a.score - b.score || a.delta - b.delta)
          const conservative = outcomes[0]
          const minimumActivity = Math.min(...outcomes.map((outcome) => outcome.activityRange?.minimum ?? outcome.activityAfter))
          const maximumActivity = Math.max(...outcomes.map((outcome) => outcome.activityRange?.maximum ?? outcome.activityAfter))
          const range = minimumActivity === maximumActivity
            ? `所有 ${outcomes.length} 种合法随机结果的活性均为 ${minimumActivity}`
            : `随机结果活性范围 ${minimumActivity}–${maximumActivity}`
          return {
            ...conservative,
            raceGroupRange: raceRanges(outcomes),
            ...(card.projection ? { activityRange: { minimum: minimumActivity, maximum: maximumActivity } } : {}),
            analysis: [
              `${range}，概率未确认，按保守下界参与推荐`,
              ...conservative.analysis,
            ],
          }
        }
      }

      const shouldOptimizeTargets = Boolean(
        card.targeting?.mode === 'choose' &&
        (!card.targeting.observedRaces || Boolean(card.projection)) &&
        !context.selectedMonsterIds?.length,
      )
      if (!shouldOptimizeTargets || !card.targeting) {
        return evaluateCard(state, card, persistent, context)
      }

      const targetSets = enumerateTargetSets(state, card.targeting)
      if (targetSets.length === 0) return evaluateCard(state, card, persistent, context)
      const results = targetSets.map((targetIds) => ({
        targetIds,
        result: evaluateObservedResolution(
          state,
          card,
          persistent,
          context,
          targetIds,
        ),
      }))
      results.sort((a, b) =>
        (state.mode === 'strategic' ? compareStartup(withStartup(state, persistent, a.result), withStartup(state, persistent, b.result)) : 0) ||
        b.result.score - a.result.score || b.result.delta - a.result.delta,
      )
      const best = results[0]
      return {
        ...best.result,
        modelUnavailable: results.find(item => item.result.modelUnavailable)?.result.modelUnavailable,
        recommendedTargetIds: best.targetIds,
        analysis: [
          `已比较 ${targetSets.length} 种合法目标组合`,
          `建议目标：${best.targetIds.map((id) => id.replace('slot-', '槽位 ')).join('、')}`,
          ...best.result.analysis,
        ],
      }
    })
    .map(result => withStartup(state, persistent, result))
    .sort((a, b) => (state.mode === 'strategic' ? compareStartup(a, b) : 0) || b.score - a.score || b.delta - a.delta)
}
