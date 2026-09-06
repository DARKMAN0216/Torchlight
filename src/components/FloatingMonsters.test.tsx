import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { candidateCards, initialState } from '../data/sampleLibrary'
import { evaluateCard } from '../engine/evaluate'
import { FloatingMonsters, floatingTargets } from './FloatingMonsters'

const state = { ...initialState, monsters: initialState.monsters.map((m, i) => ({
  ...m, race: i < 2 ? 'construct' as const : null, rarity: 'rare' as const, quantity: i < 2 ? 20 : 0, unitActivity: 30,
})) }
const chosen = candidateCards.find((c) => c.targeting?.mode === 'choose')!
const result = { ...evaluateCard(state, chosen, []), recommendedTargetIds: ['slot-1', 'slot-2'] }

describe('floating monster targets', () => {
  it('names both concrete targets and keeps six physical slots', () => {
    expect(floatingTargets(state, result)).toEqual({ ids: ['slot-1', 'slot-2'], description: '选择：槽 1 · 骨卫兵 / 稀有；槽 2 · 骨卫兵 / 稀有' })
    const html = renderToStaticMarkup(<FloatingMonsters state={state} result={result} />)
    expect(html.match(/<li /g)).toHaveLength(6)
    expect(html.match(/class="recommended-target /g)).toHaveLength(2)
    expect(html).toContain('30 × 20')
  })
  it('never highlights guessed random targets', () => {
    const random = { ...result, card: { ...chosen, targeting: { ...chosen.targeting!, mode: 'observedRandom' as const } } }
    expect(floatingTargets(state, random).ids).toEqual([])
    expect(floatingTargets(state, random).description).toContain('不能指定')
  })
  it('blocks uncertain or invalid target sets', () => {
    expect(floatingTargets({ ...state, recognitionReview: ['unknown rarity'] }, result).ids).toEqual([])
    expect(floatingTargets(state, { ...result, recommendedTargetIds: ['slot-6'] }).ids).toEqual([])
    expect(floatingTargets(state, { ...result, recommendedTargetIds: [] }).description).toContain('尚未确定')
  })
  it('distinguishes cards needing no manual target', () => {
    expect(floatingTargets(state, { ...result, card: { ...chosen, targeting: undefined } }).description).toContain('无需手动')
  })
})
