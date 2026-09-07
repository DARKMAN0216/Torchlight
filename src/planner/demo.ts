import { createPlannerModel } from './catalog'
import { fromLegacyState } from './observations'

/** Synthetic board using real card rules; this is not a measured game trajectory. */
export function createDemo() {
  const pool = ['soft-meningeal-solution', 'petrifying-spinal-solution', 'twin-hormone-construct',
    'digestive-enzyme-solution', 'probiotic-mold-solution']
  const model = createPlannerModel({
    offerPool: pool, poolLabel: '演示：仅5张已迁移药剂的实验牌池，不能外推全游戏',
  })
  const state = fromLegacyState({
    round: 8, mode: 'activity',
    monsters: [
      { id: 'slot-1', race: 'awakened', rarity: 'rare', quantity: 280, unitActivity: 30 },
      { id: 'slot-2', race: 'swarm', rarity: 'common', quantity: 50, unitActivity: 20 },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 'slot-' + (i + 3), race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0,
      })),
    ],
  }, { persistentEffects: [
    { cardId: 'dirty-bone-scraper', acquiredRound: 4, firstEligibleRound: 5, triggerCount: 3, enabled: true },
  ], offeredCardIds: pool.slice(0, 3), redrawsRemaining: 1, specialPotionStage: 0 })
  return { state, model }
}
