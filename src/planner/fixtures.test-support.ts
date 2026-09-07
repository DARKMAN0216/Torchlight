import type { CardDefinition, Monster, PlannerModel, PlannerState } from './types'
export function monster(overrides: Partial<Monster> = {}): Monster {
  return { monsterId: 'test-monster', instanceId: 'instance-1', race: 'swarm', rarity: 'common',
    quantity: 10, unitActivity: 10, ...overrides }
}
export function board(overrides: Partial<PlannerState> = {}): PlannerState {
  return { round: 10, totalRounds: 13, decisionRounds: 10, maxGroups: 6,
    slots: Array.from({ length: 6 }, (_, i) => ({ slotId: 'slot-' + (i + 1), monster: i === 0 ? monster() : null })),
    persistentEffects: [], offeredCardIds: ['noop'], redrawsRemaining: 0,
    specialPotionStage: 0, nextInstanceId: 0, recognitionReview: [], ...overrides }
}
export function model(cards: CardDefinition[] = [{ id: 'noop', name: '测试跳过', effects: [] }]): PlannerModel {
  return { version: 'test-v1', cards, persistent: [], offerPool: cards.map(c => c.id), offerCount: 1,
    offersWithReplacement: false, poolLabel: '合成测试池', monsters: [], raritySamples: [], rarityPriors: {},
    persistentOrder: 'acquisition', assumptions: ['测试假设'], maxEvents: 100 }
}
export const play = (cardId = 'noop', selectedSlotIds: string[] = []) =>
  ({ type: 'playCard' as const, cardId, selectedSlotIds })
export const runtime = (cardId: string, acquiredRound = 1) =>
  ({ cardId, acquiredRound, firstEligibleRound: acquiredRound + 1, triggerCount: 0, enabled: true })
