import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidateCards, initialState, persistentCards } from './sampleLibrary'
import { evaluateCard, rankCards } from '../engine/evaluate'
import { estimateRedraw } from '../engine/redraw'
import { mergeRecognitionSnapshot } from '../recognition/merge'
import { CandidateCardView } from '../components/CandidateCardView'

const stone = candidateCards.find((c) => c.id === 'petrifying-spinal-solution')!
const unknown = candidateCards.filter((c) => c.evaluationUnavailable)
const state = { ...initialState, monsters: initialState.monsters.map((m,i) => ({ ...m,
  race: i === 0 ? 'aberrant' as const : i === 1 ? 'construct' as const : null,
  rarity: 'boss' as const, quantity: i < 2 ? 10 : 0, unitActivity: i < 2 ? 100 : 0,
})) }

describe('new potion coverage boundaries', () => {
  it('matches the three exact OCR names without retaining old candidates', () => {
    const result = mergeRecognitionSnapshot(initialState, ['birth-bone-powder'], 3, {
      capturedAt:'now', candidateCardIds:[], phase:{value:'potionSelection',confidence:1},
      candidateCardNames:['活性育卵激素','鲜脊髓药粉','石化脊髓溶液'].map(value=>({value,confidence:1})),
    }, candidateCards)
    expect(result.candidateIds).toEqual(['active-oviposition-hormone','fresh-spinal-powder','petrifying-spinal-solution'])
    expect(result.unmatchedCandidateNames).toEqual([])
  })
  it('stone adds only 20 to an aberrant, but 50 plus mutation to a non-aberrant; preserves boss rarity', () => {
    expect(evaluateCard(state,stone,[],{selectedMonsterIds:['slot-1']}).delta).toBe(200)
    const result=evaluateCard(state,stone,[],{selectedMonsterIds:['slot-2']})
    expect(result.delta).toBe(500)
    expect(result.state.monsters[1]).toMatchObject({race:'aberrant',rarity:'boss',quantity:10,unitActivity:150})
    expect(state.monsters[1].race).toBe('construct')
  })
  it('optimizes stone target and applies the bud only on a real species change', () => {
    const bud=persistentCards.find(c=>c.id==='aberrant-bud')!
    const result=rankCards(state,[stone],[bud])[0]
    expect(result.recommendedTargetIds).toEqual(['slot-2'])
    expect(result.delta).toBe(1200) // 50*10 + 35*(10+10)
    expect(evaluateCard(state,stone,[bud],{selectedMonsterIds:['slot-1']}).delta).toBe(200)
  })
  it('does not assign unknown cards a zero score or synthesize their application', () => {
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown.every(card => card.modelWarning && card.description)).toBe(true)
    expect(rankCards(state,[...unknown,stone],[]).map(r=>r.card.id)).toEqual([stone.id])
    expect(rankCards(state,unknown,[])).toEqual([])
    for(const card of unknown) expect(()=>evaluateCard(state,card,[])).toThrow('尚未量化')
  })
  it('redraws only over evaluable cards, including a fully unknown pool', () => {
    expect(estimateRedraw(state,[...unknown,stone],[],3,0).sampleCount).toBe(1)
    expect(estimateRedraw(state,unknown,[],3,123).expectedBest).toBe(123)
  })
  it('renders an unquantified card as unknown with apply disabled, never as +0', () => {
    const html=renderToStaticMarkup(<CandidateCardView slotIndex={0} card={unknown[0]} cards={candidateCards}
      recommended={false} pending={false} disabled={false} onCardChange={()=>{}} onApply={()=>{}} />)
    expect(html).toContain('尚未量化')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('+0')
    expect(html).not.toContain('选择后活性')
  })
})
