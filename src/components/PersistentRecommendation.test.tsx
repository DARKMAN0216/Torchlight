import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidateCards, initialCandidateIds, initialState, persistentCards } from '../data/sampleLibrary'
import { rankPersistentChoices } from '../engine/persistentChoice'
import { mergeRecognitionSnapshot } from '../recognition/merge'
import { PersistentRecommendation } from './PersistentRecommendation'

describe('persistent recommendation output', () => {
  it('renders the real reward ranking instead of only listing card names', () => {
    const state = { ...initialState, monsters: initialState.monsters.map((m, i) => ({ ...m, race: i === 0 ? 'construct' as const : null, quantity: i === 0 ? 316 : 0, unitActivity: 45 })) }
    const offers = ['leather-restraint', 'dirty-bone-scraper', 'clustered-insect-eggs'].map((cardId) => ({ cardId, name: cardId, confidence: 1 }))
    const choices = persistentCards.filter((card) => offers.some((offer) => offer.cardId === card.id))
    const ranking = rankPersistentChoices(state, choices, [])
    expect(ranking[0].card.id).toBe('dirty-bone-scraper')
    const html = renderToStaticMarkup(<PersistentRecommendation offers={offers} ranking={ranking} />)
    expect(html).toContain('常驻手术用具推荐')
    expect(html).toContain('脏污刮骨刀')
    expect(html).toContain('6320')
  })
  it('explains unmapped cards rather than inventing a recommendation', () => {
    expect(renderToStaticMarkup(<PersistentRecommendation offers={[{ name: '未知卡', confidence: 1 }]} ranking={[]} />)).toContain('暂不能推荐')
  })
  it('limits recognized candidates to the actual new matches, never the old slot fallback', () => {
    const result = mergeRecognitionSnapshot(initialState, initialCandidateIds, 3, {
      capturedAt: 'now', phase: { value: 'potionSelection', confidence: 1 }, candidateCardIds: [],
      candidateCardNames: ['生骨药粉', '完全未知的药剂甲', '完全未知的药剂乙'].map((value) => ({ value, confidence: 1 })),
    }, candidateCards)
    expect(result.confirmedCandidateIds).toEqual(['birth-bone-powder'])
    expect(result.unmatchedCandidateNames).toHaveLength(2)
  })
})
