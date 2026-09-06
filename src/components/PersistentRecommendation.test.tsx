import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidateCards, initialCandidateIds, initialState, persistentCards } from '../data/sampleLibrary'
import { rankPersistentChoices } from '../engine/persistentChoice'
import { mergeRecognitionSnapshot } from '../recognition/merge'
import { PersistentRecommendation } from './PersistentRecommendation'
import { OpeningWarning } from './OpeningWarning'

describe('persistent recommendation output', () => {
  it('shows the red opening hint without blocking choices or claiming no effects', () => {
    const state = { ...initialState, round: 1, monsters: initialState.monsters.map((m) =>
      ({ ...m, race: 'swarm' as const, quantity: 36, unitActivity: 1 })) }
    const choices = persistentCards.filter(c => ['hypertrophic-pituitary', 'aberrant-bud', 'contracted-claw'].includes(c.id))
    const offers = choices.map(c => ({ cardId: c.id, name: c.name, confidence: 1 }))
    const ranking = rankPersistentChoices(state, choices, [])
    const html = renderToStaticMarkup(<><OpeningWarning offers={offers} state={state} /><PersistentRecommendation offers={offers} ranking={ranking} /></>)
    expect(html).toContain('opening-mismatch-warning')
    expect(html).toContain('天崩开局')
    expect(html).toContain('不代表所有效果无效')
    expect(renderToStaticMarkup(<OpeningWarning offers={[...offers.slice(0, 2), { name: '未知', confidence: 1 }]} state={state} />)).not.toContain('天崩开局')
    expect(renderToStaticMarkup(<OpeningWarning offers={offers} state={{ ...state, round: 2 }} />)).not.toContain('天崩开局')
  })
  it('displays the warning even with no ranking and no model IDs', () => {
    const state = { ...initialState, round: 1, monsters: initialState.monsters.map(m => ({...m,race:'awakened' as const,quantity:24})) }
    const offers = ['孽生肉芽','人蛹标本','挛缩指爪'].map(name => ({name,confidence:1}))
    const html = renderToStaticMarkup(<><OpeningWarning offers={offers} state={state} /><PersistentRecommendation offers={offers} ranking={[]} /></>)
    expect(html).toContain('天崩开局')
    expect(html).toContain('不考虑稀有度、数量门槛或模型评分')
    expect(html).toContain('暂不能推荐')
  })
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
