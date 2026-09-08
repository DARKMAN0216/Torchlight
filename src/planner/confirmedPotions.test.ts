import { expect, it } from 'vitest'
import { confirmedPotions } from './confirmedPotions'
import { resolvePotionPreview, getLegalActions } from './simulator'
import { board, monster, model, runtime } from './fixtures.test-support'
import { implementedPersistent } from './persistentCatalog'
import type { Random } from './random'
import { rarityIds, type GameState } from '../types/game'
import { candidateCards, persistentCards } from '../data/sampleLibrary'
import { evaluateCard, rankCards } from '../engine/evaluate'
import { parsePersistentModel } from '../engine/persistentModelData'
import { freshRarityBase } from './rarityBases'

// Synthetic fixtures, deliberately NOT asserted to be real game base values.
const bases = { common: { quantity: 10, unitActivity: 2 }, magic: { quantity: 20, unitActivity: 3 },
  rare: { quantity: 30, unitActivity: 4 }, boss: { quantity: 40, unitActivity: 5 } }
const rule = (name: string) => confirmedPotions.find(c => c.name === name)!
const conf = () => ({ ...model(confirmedPotions), rarityBases: bases, persistent: implementedPersistent })
const state = (count = 1) => board({ round: 5, slots: Array.from({ length: 6 }, (_, i) => ({ slotId: `slot-${i+1}`,
  monster: i < count ? monster({ instanceId: `instance-${i}`, quantity: 100+i, unitActivity: 50+i }) : null })) })
const run = (name: string, s = state(), targets = ['slot-1'], rng: Random = () => 0, config = conf(), end = false) =>
  resolvePotionPreview(s, rule(name), rule(name).targeting ? targets : [], config, rng, end)
const legacy = (s = state()): GameState => ({ round: s.round, mode: 'activity', persistentModel: { rarityBases: bases },
  monsters: s.slots.map(slot => ({ id: slot.slotId, race: slot.monster?.race ?? null,
    rarity: slot.monster?.rarity ?? 'common', quantity: slot.monster?.quantity ?? 0, unitActivity: slot.monster?.unitActivity ?? 0 })) })

it('preserves seven regular and eight special stable IDs and activates both catalogs', () => {
  expect(confirmedPotions).toHaveLength(15)
  for (const p of confirmedPotions) expect(candidateCards.find(c => c.id === p.id)).toMatchObject({ name: p.name, confirmedPotion: true, requiresScreenSync: true })
})
it.each(rarityIds)('twin uses fresh %s stats, never accumulated stats', rarity => {
  const s = state(); s.slots[0].monster!.race = 'construct'; s.slots[0].monster!.rarity = rarity
  const result = run('孪生激素-蛊虫', s)
  expect(result.state.slots[0].monster).toMatchObject({ race: 'swarm', rarity, quantity: 100, unitActivity: 50 })
  expect(result.state.slots[1].monster).toMatchObject({ race: 'swarm', rarity, ...bases[rarity] })
  expect(result.events.filter(e => e.type === 'addSucceeded')).toHaveLength(1)
})
it('eggshell adds 25 separately to the old group and the fresh same-class group', () => {
  const result = run('卵壳药粉')
  expect(result.state.slots[0].monster).toMatchObject({ quantity: 125, unitActivity: 50 })
  expect(result.state.slots[1].monster).toMatchObject({ quantity: 35, unitActivity: 2 })
  const s = state(); s.slots[0].monster!.race = 'construct'
  const m = conf(); m.rarityBases = {} as typeof bases
  expect(run('卵壳药粉', s, [], () => 0, m).events.some(e => e.type === 'addAttempted')).toBe(false)
})
it('full-board eggshell boosts the old group and emits a failure without needing base values', () => {
  const m = conf(); m.rarityBases = {} as typeof bases
  const result = run('卵壳药粉', state(6), [], () => 0, m)
  expect(result.state.slots[0].monster!.quantity).toBe(125)
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(1)
})
it('viscous bile copies only class, preserving right-side quantity/activity before +31', () => {
  const s = state(2); s.slots[0].monster!.race = 'construct'; s.slots[1].monster!.rarity = 'boss'
  const result = run('黏稠胆汁溶液', s)
  expect(result.state.slots[0].monster).toMatchObject({ quantity: 100, unitActivity: 81 })
  expect(result.state.slots[1].monster).toMatchObject({ race: 'construct', rarity: 'common', quantity: 101, unitActivity: 82 })
  expect(result.events.filter(e => e.type === 'mutationCompleted')).toHaveLength(1)
  expect(result.events.some(e => e.type === 'removeSucceeded' || e.type === 'addSucceeded')).toBe(false)
})
it('empty-right bile still boosts the selected target without a mutation event', () => {
  const s = state(), original = structuredClone(s)
  const result = run('黏稠胆汁溶液', s)
  expect(result.state.slots[0].monster!.unitActivity).toBe(81)
  expect(result.events.some(e => e.type === 'mutationCompleted')).toBe(false)
  expect(s).toEqual(original)
})
it.each([false, true])('fusion requires two targets, sums both stats, and randomizes rarity (mixed=%s)', mixed => {
  const s = state(2); if (mixed) s.slots[1].monster!.rarity = 'boss'
  expect(() => run('蜕生皮溶液', s, ['slot-1'])).toThrow('目标')
  const types = new Set<string>()
  for (let index = 0; index < 4; index++) {
    const result = run('蜕生皮溶液', s, ['slot-1','slot-2'], () => (index + .1)/4)
    const fused = result.state.slots[0].monster!
    expect(fused).toMatchObject({ race: 'swarm', quantity: 201, unitActivity: 101 })
    types.add(fused.rarity)
    expect(result.events.filter(e => e.type === 'removeSucceeded')).toHaveLength(2)
    expect(result.events.filter(e => e.type === 'addSucceeded')).toHaveLength(1)
  }
  expect([...types]).toEqual(rarityIds)
  s.offeredCardIds = [rule('蜕生皮溶液').id]
  expect(getLegalActions(s, conf()).filter(a => a.type === 'playCard')).toHaveLength(1)
})
it('last-slot bile boosts the original without wrapping around to slot one', () => {
  const s = state(6)
  const result = run('黏稠胆汁溶液', s, ['slot-6'])
  expect(result.state.slots[5].monster!.unitActivity).toBe(86)
  expect(result.state.slots[0].monster!.unitActivity).toBe(50)
  expect(result.events.some(e => e.type === 'mutationCompleted')).toBe(false)
})
it('xeno removes all selected groups before four attempts, applies fresh rarity stats +5 activity', () => {
  const result = run('异种激素', state(6), ['slot-1','slot-2'])
  expect(result.events.map(e => e.type).slice(0,5)).toEqual(['cardPlayed','removeSucceeded','removeSucceeded','addAttempted','addSucceeded'])
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(2)
  expect(result.state.slots[0].monster).toMatchObject({ quantity: 10, unitActivity: 7, rarity: 'common' })
  expect(result.state.slots.filter(s => s.monster)).toHaveLength(6)
})
it('random births can reach all four rarities and do not reuse one roll for multiple groups', () => {
  const draws = [.01, .01, .3, .01, .55, .01, .99, .01]
  const result = run('异种激素', state(), ['slot-1'], () => draws.shift()!)
  expect(result.state.slots.slice(0,4).map(s => s.monster!.rarity)).toEqual(rarityIds)
})
it.each([0,1,2])('lure applies each overflow to current swarm including newly born groups (%s free)', free => {
  const s = state(6-free)
  const result = run('诱虫剂', s)
  const overflow = 4-free
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(overflow)
  expect(result.state.slots[0].monster).toMatchObject({ quantity: 100 + overflow*15, unitActivity: 50+overflow*10 })
  if (free) expect(result.state.slots[5].monster).toMatchObject({ quantity: 10+overflow*15, unitActivity: 2+overflow*10 })
})
it('lure invokes successful-add and full-board passives separately for every attempt', () => {
  const s = state(5); s.persistentEffects = [runtime('hatching-sac'), runtime('two-inch-skull-nail')]
  const result = run('诱虫剂', s)
  // new common: 10/2 -> hatching 55/2 -> three overflows (+45/+30), three nails (+75/+75)
  expect(result.state.slots[5].monster).toMatchObject({ quantity: 175, unitActivity: 107 })
  expect(result.events.filter(e => e.type === 'addSucceeded')).toHaveLength(1)
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(3)
})
it('oviposition independently rolls each group after its 50% extra-two decision', () => {
  const draws = [.01, .1, .3, .99]
  const result = run('活性育卵激素', state(), [], () => draws.shift()!)
  expect(result.state.slots.slice(1,4).map(s => s.monster!.rarity)).toEqual(['common','magic','boss'])
  const failDraws = [.01, .9]
  expect(run('活性育卵激素', state(), [], () => failDraws.shift()!).events.filter(e => e.type === 'addSucceeded')).toHaveLength(1)
})
it('missing any legal rarity blocks births; conflicting bases/priors are not used as growth-copy fallbacks', () => {
  const m = conf(); m.rarityBases = { common: bases.common } as typeof bases
  expect(() => run('活性育卵激素', state(), [], () => 0, m)).toThrow('magic')
  const empty = model(); empty.rarityPriors.common = [bases.common]
  expect(() => freshRarityBase(empty, 'common')).toThrow('缺少')
  empty.monsters = [monster(), monster({ monsterId: 'different', quantity: 99 })]
  expect(() => freshRarityBase(empty, 'common')).toThrow('冲突')
  empty.rarityBases = { common: bases.common }
  expect(freshRarityBase(empty, 'common')).toEqual(bases.common)
})
it('desktop shares mechanics, preserves actual input, compares only legal two-target fusion choices', () => {
  const source = legacy(state(3)), original = structuredClone(source)
  const fusion = candidateCards.find(c => c.name === '蜕生皮溶液')!
  const r = rankCards(source, [fusion], [])[0]
  expect(r.recommendedTargetIds).toHaveLength(2)
  expect(r.state).toEqual(original)
  expect(source).toEqual(original)
  expect(r.requiresOutcomeSync).toBe(true)
  expect(evaluateCard(legacy(state()), fusion, []).modelUnavailable).toContain('目标')
})
it('desktop ignores obsolete single-swarm settings and never recommends missing birth data', () => {
  const source = legacy(); delete source.persistentModel
  source.newbornSwarm = { rarity: 'common', quantity: 999, unitActivity: 999 }
  const egg = candidateCards.find(c => c.name === '活性育卵激素')!
  const r = rankCards(source, [egg], [])[0]
  expect(r.modelUnavailable).toContain('rarityBases')
  expect(r.state).toEqual(source)
})
it('desktop includes passive round-end growth once and preserves all random fusion outcomes', () => {
  const s = state(2); s.slots[0].monster!.quantity = 300
  const source = legacy(s), fusion = candidateCards.find(c => c.name === '蜕生皮溶液')!
  const loadout = persistentCards.filter(p => p.id === 'dirty-bone-scraper')
  const r = evaluateCard(source, fusion, loadout, { selectedMonsterIds: ['slot-1','slot-2'] })
  expect(r.activityAfter).toBe(401*101)
  expect(r.settlement?.projectedActivity).toBe(401*121)
  expect(r.state).toEqual(source)
})
it('parses separate fresh-rarity bases without treating them as mutation priors', () => {
  expect(parsePersistentModel(JSON.stringify({ rarityBases: bases }))).toEqual({ rarityBases: bases })
  expect(() => parsePersistentModel('{"rarityBases":{"boss":{"quantity":0,"unitActivity":1}}}')).toThrow()
  expect(() => parsePersistentModel('{"rarityBases":{"unknown":{"quantity":1,"unitActivity":1}}}')).toThrow()
})
