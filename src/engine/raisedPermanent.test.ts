import { expect, it } from 'vitest'
import { persistentCards } from '../data/sampleLibrary'
import { evaluateCard, evaluateRoundEndTransition } from './evaluate'
import { rankPersistentChoices } from './persistentChoice'
import type { GameState, RaceId, RarityId } from '../types/game'

const persistent = (id: string) => persistentCards.find(card => card.id === id)!
const group = (id: string, race: RaceId, unitActivity = 1, rarity: RarityId = 'common') => ({ id, race, unitActivity, quantity: 36, rarity })
const state = (monsters: GameState['monsters']): GameState => ({ round: 1, mode: 'strategic', monsters })

it('maps all raised screenshot choices without treating aberrant boss as awakened', () => {
  const source = state([group('1','construct'),group('2','construct'),{...group('3','aberrant',300,'boss'),quantity:1},group('4','awakened')])
  const ranking = rankPersistentChoices(source, ['mottled-liver','hypertrophic-pituitary','human-pupa'].map(persistent), [])
  expect(ranking).toHaveLength(3)
  expect(ranking[0].card.name).toBe('斑斓肝脏')
  expect(ranking.find(item => item.card.id === 'hypertrophic-pituitary')?.scoreDelta).toBe(0)
  expect(ranking.every(item => item.nextRoundEndBonus === 0)).toBe(true)
})

it('previews pupa bounds without mutating state', () => {
  const source = state([group('1','swarm',10),group('2','swarm',20),group('3','aberrant',30)])
  const before = structuredClone(source)
  const result = evaluateRoundEndTransition(source, persistent('human-pupa'))
  expect(result.bonus).toBe(480)
  expect(result.analysis.join()).toContain('480–800')
  expect(source).toEqual(before)
})

it('liver triggers on any actual mutation while threshold remains met, not same-race conversion', () => {
  const source = state([group('1','aberrant'),group('2','aberrant'),group('3','construct')])
  const card = { id:'test',name:'test',rarity:1 as const,description:'',tags:[],effects:[{type:'convertRace' as const,target:'selected' as const,to:'swarm' as const}] }
  const result = evaluateCard(source, card, persistent('mottled-liver'), {selectedMonsterIds:['3']})
  expect(result.state.monsters.map(item => item.unitActivity)).toEqual([21,21,21])
  const unchanged = evaluateCard(result.state, card, persistent('mottled-liver'), {selectedMonsterIds:['3']})
  expect(unchanged.state.monsters.map(item => item.unitActivity)).toEqual([21,21,21])
  const boundary = evaluateCard(source, card, persistent('mottled-liver'), {selectedMonsterIds:['1']})
  expect(boundary.warnings.join()).toContain('条件在事件处理时判定')
  expect(boundary.state.monsters.map(item => item.unitActivity)).toEqual([1,1,1])
})
