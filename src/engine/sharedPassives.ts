import type { EvaluationContext, GameState, MonsterGroup, PersistentLoadout } from '../types/game'
import { implementedPersistent } from '../planner/persistentCatalog'
import { resolvePersistentEvents, resolvePotionPreview } from '../planner/simulator'
import { seededRandom, type Random } from '../planner/random'
import type { CardDefinition, GameEvent, Monster, PassiveObservations, PlannerModel, PlannerState } from '../planner/types'
import { persistentCardsIn } from './persistent'
import { cocoonId } from '../planner/specialPotions'

export const usesSharedPassives = (loadout: PersistentLoadout) => persistentCardsIn(loadout).some(p => p.sharedRules)
export const asPlannerMonster = (m: MonsterGroup, instanceId = 'legacy:' + m.id): Monster => ({
  monsterId: m.specialIdentity === 'hollow-cocoon' ? cocoonId
    : `${m.specialIdentity === 'ordinary' ? 'class' : 'unresolved'}:${m.race}:${m.rarity}`, instanceId, race: m.race!, rarity: m.rarity,
  quantity: m.quantity, unitActivity: m.unitActivity,
})
export interface PassivePreview {
  outcomes: Array<{ state: GameState; weight: number }>
  exhaustive: boolean
  warnings: string[]
  unavailable?: string
}
class Fork extends Error {
  constructor(readonly weights: number[]) { super('random branch') }
}
const cache = new Map<string, PassivePreview>()

/** Bounded exact enumeration, then explicitly labelled sampling for large chains. No real state writes. */
export function previewPassives(
  source: GameState, loadout: PersistentLoadout, events: GameEvent[],
  instances: Record<string, string> = {}, context: EvaluationContext = {},
  potion?: { card: CardDefinition; targets: string[]; includeRoundEnd: boolean },
): PassivePreview {
  const cards = persistentCardsIn(loadout).filter(p => p.sharedRules)
  if (!potion && (!cards.length || !events.length || source.round > 13))
    return { outcomes: [{ state: source, weight: 1 }], exhaustive: true, warnings: [] }
  const key = JSON.stringify([source, cards.map(p => p.id), events, instances, context, potion])
  const cached = cache.get(key)
  if (cached) return cached
  const model: PlannerModel = {
    version: 'desktop-passives-v2', cards: [], persistent: implementedPersistent,
    offerPool: [], offerCount: 3, offersWithReplacement: false, poolLabel: '本轮常驻预览',
    monsters: [], raritySamples: [], rarityPriors: {}, persistentOrder: 'acquisition',
    pupaRepetitions: 'totalX', assumptions: [], maxEvents: 512, ...source.persistentModel,
  }
  if (!potion && !model.monsters.length && source.newbornSwarm) model.monsters = [{
    monsterId: 'user-confirmed-newborn-swarm', race: 'swarm', ...source.newbornSwarm,
  }]
  const slots = source.monsters.map(m => ({ slotId: m.id,
    monster: m.race && m.quantity > 0 ? asPlannerMonster(m, instances[m.id]) : null }))
  while (slots.length < 6) {
    let id = `empty-${slots.length + 1}`
    while (slots.some(s => s.slotId === id)) id += '-'
    slots.push({ slotId: id, monster: null })
  }
  const state: PlannerState = {
    round: source.round, totalRounds: 13, decisionRounds: 10, maxGroups: 6, slots,
    persistentEffects: cards.map(p => { const acquiredRound = source.persistentAcquiredRounds?.[p.id] ?? 0
      return { cardId: p.id, acquiredRound, firstEligibleRound: acquiredRound + 1, triggerCount: 0, enabled: true }
    }),
    offeredCardIds: [], redrawsRemaining: 0, specialPotionStage: 0, nextInstanceId: 0, recognitionReview: [],
  }
  const observations: PassiveObservations = {
    targetSlotIds: { ...context.observedPersistentTriggerTargetIdsByCardId },
    mutatedAdditionSlotIds: context.observedAddedGroupMutationIdsByCardId,
  }
  const removalCards = cards.filter(p => p.onRemovalQuantityBonus)
  if (removalCards.length === 1 && context.observedPersistentTriggerTargetIds?.length)
    observations.targetSlotIds![removalCards[0].id] = context.observedPersistentTriggerTargetIds
  const warnings = new Set<string>(['常驻按获得顺序结算（旧记录按列表顺序），条件在事件处理时判定；未确认顺序可通过 persistentModel.persistentOrder 切换'])
  const outcomes: PassivePreview['outcomes'] = []
  const run = (random: Random, weight: number) => {
    const result = potion ? resolvePotionPreview(state, potion.card, potion.targets, model, random, potion.includeRoundEnd)
      : resolvePersistentEvents(state, events, model, random, observations)
    result.warnings.forEach(w => warnings.add(w))
    outcomes.push({ weight, state: { ...source, monsters: result.state.slots.filter(s => s.monster || source.monsters.some(m => m.id === s.slotId)).map(s => ({
      id: s.slotId, race: s.monster?.race ?? null, rarity: s.monster?.rarity ?? 'common',
      quantity: s.monster?.quantity ?? 0, unitActivity: s.monster?.unitActivity ?? 0,
      ...(s.monster?.monsterId === cocoonId ? { specialIdentity: 'hollow-cocoon' as const }
        : s.monster?.race === 'swarm' && s.monster.rarity === 'boss' && !s.monster.monsterId.startsWith('unresolved:')
          ? { specialIdentity: 'ordinary' as const } : {}),
    })) } })
  }
  let exhaustive = true
  const pending: Array<{ path: number[]; weight: number }> = [{ path: [], weight: 1 }]
  let attempts = 0
  try {
    while (pending.length && attempts++ < 128) {
      const branch = pending.pop()!
      let offset = 0
      const random: Random = () => { throw new Error('随机分支未声明') }
      random.choose = weights => {
        if (offset >= branch.path.length) throw new Fork(weights)
        return branch.path[offset++]
      }
      try { run(random, branch.weight) } catch (e) {
        if (!(e instanceof Fork)) throw e
        e.weights.forEach((weight, i) => {
          if (weight > 0) pending.push({ path: [...branch.path, i], weight: branch.weight * weight })
        })
      }
    }
    if (pending.length) {
      exhaustive = false
      outcomes.length = 0
      for (let seed = 0; seed < 32; seed++) run(seededRandom(20260908 + seed), 1 / 32)
      warnings.add('分支较多，采用32条可复现样本；最小值仅为样本下界，不是真实保底')
    }
  } catch (e) {
    const unavailable = e instanceof Error ? e.message : String(e)
    return { outcomes: [], exhaustive: false, warnings: [...warnings], unavailable }
  }
  const result = { outcomes, exhaustive, warnings: [...warnings] }
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

export function confirmedRoundEnd(source: GameState, loadout: PersistentLoadout): { state?: GameState; reason?: string } {
  const preview = previewPassives(source,loadout,[{type:'roundEnd',source:'round',round:source.round}])
  if (preview.unavailable) return { reason: preview.unavailable }
  if (!preview.exhaustive || new Set(preview.outcomes.map(o=>JSON.stringify(o.state.monsters))).size !== 1)
    return { reason: '回合结束存在不同随机结果，请在游戏结算后按 F8 同步' }
  return { state: preview.outcomes[0].state }
}
