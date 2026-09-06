import { describe, expect, it } from 'vitest'
import { persistentCards } from '../data/sampleLibrary'
import type { GameState } from '../types/game'
import { openingRouteMismatch } from './openingWarning'
import { openingCardRaces, openingRacesForName } from '../data/openingCardRaces'
import { realCardCatalog } from '../data/realCardCatalog'

const ids = ['hypertrophic-pituitary', 'aberrant-bud', 'contracted-claw']
const choices = ids.map((id) => persistentCards.find((card) => card.id === id)!)
const state: GameState = {
  round: 1, mode: 'activity',
  monsters: Array.from({ length: 6 }, (_, index) => ({
    id: `slot-${index + 1}`, race: index < 4 ? 'swarm' : null,
    rarity: 'common', quantity: index < 4 ? 36 : 0, unitActivity: index < 4 ? 1 : 0,
  })),
}

describe('opening route mismatch warning (not effect eligibility)', () => {
  it('flags the supplied four-swarm opening against the three offered routes', () => {
    expect(openingRouteMismatch(state, choices)).toEqual(['awakened', 'aberrant', 'construct'])
  })
  it('clears as soon as any living group matches a route, regardless of rarity', () => {
    expect(openingRouteMismatch({ ...state, monsters: state.monsters.map((m, i) =>
      i === 0 ? { ...m, race: 'awakened', rarity: 'common' } : m) }, choices)).toBeNull()
  })
  it('ignores zero-quantity remnants and does not warn on an empty board', () => {
    const monsters = state.monsters.map((m, i) => i === 5 ? { ...m, race: 'construct' as const } : m)
    expect(openingRouteMismatch({ ...state, monsters }, choices)).not.toBeNull()
    expect(openingRouteMismatch({ ...state, monsters: [] }, choices)).toBeNull()
  })
  it('does not warn after round one or on unconfirmed monsters', () => {
    expect(openingRouteMismatch({ ...state, round: 2 }, choices)).toBeNull()
    expect(openingRouteMismatch({ ...state, recognitionReview: ['slot-1未知'] }, choices)).toBeNull()
  })
  it('does not declare a complete mismatch when a choice is absent or generic', () => {
    expect(openingRouteMismatch(state, choices.slice(0, 2))).toBeNull()
    for (const id of ['dirty-bone-scraper', 'black-goat-suture', 'leather-restraint']) {
      expect(openingRouteMismatch(state, [...choices.slice(0, 2), persistentCards.find(c => c.id === id)!])).toBeNull()
    }
  })
  it('covers all 24 real permanent names independently of modeled cards', () => {
    const names = realCardCatalog.filter(card => card.category === '手术用具').map(card => card.name)
    expect(names).toHaveLength(24)
    expect(Object.keys(openingCardRaces).sort()).toEqual(names.sort())
    expect(openingRacesForName('人蛹标本')).toEqual(['swarm'])
    expect(openingRacesForName('孵化囊')).toEqual(['swarm'])
    expect(openingRacesForName('蔓生肉芽')).toEqual(['aberrant'])
    expect(openingRacesForName('未知')).toBeUndefined()
    expect(openingRacesForName('constructor')).toBeUndefined()
  })
  it('warns on the latest all-awakened opening using names only', () => {
    const board = { ...state, monsters: state.monsters.map(m => m.race ? { ...m, race: 'awakened' as const } : m) }
    const offers = ['孽生肉芽','人蛹标本','挛缩指爪'].map(name => ({name,confidence:1}))
    expect(openingRouteMismatch(board, offers)).toEqual(['aberrant','swarm','construct'])
    expect(openingRouteMismatch({ ...board, mode:'strategic' }, offers)).toEqual(['aberrant','swarm','construct'])
    expect(openingRouteMismatch(board, offers.map(card => ({...card, strategicProfile:{rules:[]}, roundEndEffect:undefined})))).not.toBeNull()
    expect(openingRouteMismatch(board, [{name:'孵化囊'}, {name:'粘连跖骨'}, {name:'斑斓肝脏'}])).not.toBeNull()
    expect(openingRouteMismatch(board, [...offers.slice(0,2), {name:'挛缩指爪',confidence:.6}])).toBeNull()
  })
})
