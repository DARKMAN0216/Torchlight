import { describe, expect, it } from 'vitest'
import type { EvaluationResult } from '../types/game'
import { applyOpportunityPolicy } from './opportunity'

const result = (
  id: string,
  scoreDelta: number,
  followUpOfferCount?: 3 | 5,
): EvaluationResult => ({
  card: {
    id,
    name: id,
    rarity: 1,
    description: '',
    tags: [],
    effects: [],
    followUpOfferCount,
  },
  state: { round: 1, mode: 'activity', monsters: [] },
  activityBefore: 100,
  activityAfter: 100 + scoreDelta,
  delta: scoreDelta,
  score: 100 + scoreDelta,
  scoreDelta,
  scoreLabel: '即时活性',
  analysis: [],
  trace: [],
  warnings: [],
})

describe('opportunity policy', () => {
  it('prefers a potion box when every ordinary card has no positive score', () => {
    const decision = applyOpportunityPolicy([
      result('weak', 0),
      result('box', 0, 3),
      result('harmful', -20),
    ], 3)

    expect(decision.preferPotionBox).toBe(true)
    expect(decision.preferRedraw).toBe(false)
    expect(decision.ranking[0].card.id).toBe('box')
    expect(decision.ranking[0].analysis[0]).toContain('保留全局洗牌次数')
  })

  it('keeps a positive card ahead of the box', () => {
    const decision = applyOpportunityPolicy([
      result('strong', 10),
      result('box', 0, 3),
    ], 3)

    expect(decision.preferPotionBox).toBe(false)
    expect(decision.ranking[0].card.id).toBe('strong')
  })

  it('recommends a remaining reroll only when there is no box or positive card', () => {
    expect(applyOpportunityPolicy([result('weak', 0)], 3).preferRedraw).toBe(true)
    expect(applyOpportunityPolicy([result('weak', 0)], 0).preferRedraw).toBe(false)
  })
})
