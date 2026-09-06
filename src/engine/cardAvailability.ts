import { rarityIds, type CandidateCard, type GameState } from '../types/game'
export function canEvaluateCard(state: GameState, card: CandidateCard): boolean {
  if (card.evaluationUnavailable) return false
  if (!card.requiresNewbornSwarm) return true
  const base = state.newbornSwarm
  return Boolean(base && Number.isSafeInteger(base.quantity) && base.quantity > 0 &&
    Number.isSafeInteger(base.unitActivity) && base.unitActivity > 0 && rarityIds.includes(base.rarity))
}
