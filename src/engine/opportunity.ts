import type { EvaluationResult } from '../types/game'

export const goodCardMinimumScoreDelta = 1

export interface OpportunityDecision {
  ranking: EvaluationResult[]
  preferPotionBox: boolean
  preferRedraw: boolean
}

export function applyOpportunityPolicy(
  ranking: EvaluationResult[],
  rerollsRemaining: number,
): OpportunityDecision {
  if (ranking.some(item => item.settlement?.uncertain || (item.state.mode === 'strategic' && item.startup?.safeForPriority))) {
    return { ranking, preferPotionBox: false, preferRedraw: false }
  }
  const potionBox = ranking.find((result) => result.card.followUpOfferCount)
  const ordinaryCards = ranking.filter((result) => !result.card.followUpOfferCount)
  const hasGoodOrdinaryCard = ordinaryCards.some(
    (result) => result.scoreDelta >= goodCardMinimumScoreDelta,
  )
  const preferPotionBox = Boolean(potionBox && !hasGoodOrdinaryCard)
  const prioritizedPotionBox = preferPotionBox && potionBox
    ? {
        ...potionBox,
        analysis: [
          '机会策略：当前非药剂箱候选均无正向评分，优先展开药剂箱，保留全局洗牌次数。',
          ...potionBox.analysis,
        ],
      }
    : potionBox
  const reordered = preferPotionBox && prioritizedPotionBox
    ? [prioritizedPotionBox, ...ranking.filter((result) => result !== potionBox)]
    : ranking

  return {
    ranking: reordered,
    preferPotionBox,
    preferRedraw: !potionBox && !hasGoodOrdinaryCard && rerollsRemaining > 0,
  }
}
