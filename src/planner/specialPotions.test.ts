import { expect, it } from 'vitest'
import { specialPotions, cocoonId } from './specialPotions'
import { confirmedPotions } from './confirmedPotions'
import { board, monster, model, runtime } from './fixtures.test-support'
import { drawOffer, resolvePotionPreview, simulateAction } from './simulator'
import { implementedPersistent } from './persistentCatalog'
import type { CardDefinition, PlannerModel } from './types'
import { seededRandom, type Random } from './random'
import { candidateCards } from '../data/sampleLibrary'
import { evaluateCard, rankCards } from '../engine/evaluate'
import { asPlannerMonster } from '../engine/sharedPassives'
import { parsePersistentModel } from '../engine/persistentModelData'
import { rarityIds, type GameState } from '../types/game'

// Synthetic numbers, never default game data.
const bases = { common: { quantity: 10, unitActivity: 2 }, magic: { quantity: 20, unitActivity: 4 },
  rare: { quantity: 30, unitActivity: 6 }, boss: { quantity: 40, unitActivity: 8 } }
const rule = (kind: string) => specialPotions.find(c => c.effects.some(e => e.type === 'specialPotion' && e.kind === kind))!
const conf = (): PlannerModel => ({ ...model(confirmedPotions), rarityBases: bases, persistent: implementedPersistent })
const state = (count = 1) => board({ round: 4, slots: Array.from({ length: 6 }, (_, i) => ({ slotId: `slot-${i+1}`,
  monster: i < count ? monster({ instanceId: `i-${i}`, quantity: 100, unitActivity: 20 }) : null })) })
const run = (kind: string, s = state(), m = conf(), random: Random = () => 0, end = false) =>
  resolvePotionPreview(s, rule(kind), [], m, random, end)

it('never uses an ordinary boss base for the special cocoon', () => {
  const s = state(), original = structuredClone(s)
  expect(() => run('cocoon', s)).toThrow('specialBases.hollowCocoon')
  expect(s).toEqual(original)
  const m = conf(); m.specialBases = { hollowCocoon: { quantity: 17, unitActivity: 23 } }
  expect(run('cocoon', s, m).state.slots[1].monster).toMatchObject({ monsterId: cocoonId, race: 'swarm', rarity: 'boss', quantity: 17, unitActivity: 23 })
})
it('full cocoon fails to obtain but still schedules two extra special candidates', () => {
  const s = state(6), m = conf(); delete m.rarityBases
  const result = run('cocoon', s, m)
  expect(result.state.slots).toEqual(s.slots)
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(1)
  expect(result.state.specialOffer).toEqual(rule('cocoon').specialOffer)
  expect(result.warnings.join()).toContain('高概率')
})
it.each([['copy1', 10], ['copy2', 20], ['copy3', 30]] as const)('%s snapshots grown values before this card increment', (kind, bonus) => {
  const s = state(); s.slots[0].monster!.quantity = 777; s.slots[0].monster!.unitActivity = 333
  const m = conf(); delete m.rarityBases
  const result = run(kind, s, m)
  for (const slot of result.state.slots.slice(0, 2)) expect(slot.monster).toMatchObject({ quantity: 777 + bonus, unitActivity: 333 })
  expect(result.state.slots[0].monster!.instanceId).not.toBe(result.state.slots[1].monster!.instanceId)
  expect(result.events.find(e => e.type === 'addSucceeded')?.after?.quantity).toBe(777)
  expect(s.slots[0].monster!.quantity).toBe(777)
})
it.each(['copy1', 'copy2', 'copy3'])('%s full board still grows its original', kind => {
  const result = run(kind, state(6))
  expect(result.state.slots[0].monster!.quantity).toBe(100 + { copy1: 10, copy2: 20, copy3: 30 }[kind]!)
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(1)
  expect(result.state.specialOffer).toBeDefined()
})
it('copy can select every swarm, excludes other races, and needs no target when none exist', () => {
  const s = state(3); s.slots[0].monster!.race = 'construct'
  expect(run('copy1', s, conf(), () => .99).state.slots[2].monster!.quantity).toBe(110)
  expect(run('copy1', s).state.slots[0].monster!.quantity).toBe(100)
  const empty = run('copy1', state(0))
  expect(empty.events.some(e => e.type === 'addAttempted')).toBe(false)
  expect(empty.state.specialOffer?.count).toBe(2)
})
it('copy preserves cocoon identity, while mutation invalidates it even with identical class', () => {
  const s = state(); Object.assign(s.slots[0].monster!, { monsterId: cocoonId, race: 'swarm', rarity: 'boss' })
  expect(run('copy1', s).state.slots[1].monster!.monsterId).toBe(cocoonId)
  const mutation: CardDefinition = { id: 'mutation', name: 'mutation', effects: [{ type: 'mutate', target: { mode: 'all' }, race: 'swarm' }] }
  const changed = resolvePotionPreview(s, mutation, [], conf(), () => 0, false)
  expect(changed.state.slots[0].monster!.monsterId).not.toBe(cocoonId)
  expect(changed.events.filter(e => e.type === 'mutationCompleted')).toHaveLength(1)
  expect(run('mother', changed.state).state.slots).toEqual(changed.state.slots)
  const legacy: GameState = { round: 4, mode: 'activity', monsters: s.slots.map(slot => ({
    id: slot.slotId, race: slot.monster?.race ?? null, rarity: slot.monster?.rarity ?? 'common',
    quantity: slot.monster?.quantity ?? 0, unitActivity: slot.monster?.unitActivity ?? 0,
    ...(slot.monster ? { specialIdentity: 'hollow-cocoon' as const } : {}),
  })) }
  const result = evaluateCard(legacy, { id: 'legacy-mutation', name: '旧引擎变异验证', rarity: 1, description: '', tags: [],
    effects: [{ type: 'convertRace', target: 'swarm', to: 'swarm' }] }, [])
  expect(result.state.monsters[0].specialIdentity).toBe('ordinary')
})
it('mother adds percentage points before multiplying, sums both attributes, and outputs a cocoon', () => {
  const s = state(4)
  Object.assign(s.slots[0].monster!, { monsterId: cocoonId, rarity: 'boss' })
  s.slots[1].monster!.rarity = 'magic'; s.slots[3].monster!.race = 'construct'
  const result = run('mother', s)
  // 75 + 30 + 15 = 120%; (400,80) * 2.2, not sequential multiplication.
  expect(result.state.slots[0].monster).toMatchObject({ monsterId: cocoonId, quantity: 880, unitActivity: 176 })
  expect(result.events.filter(e => e.type === 'removeSucceeded')).toHaveLength(4)
  expect(result.events.filter(e => e.type === 'fusionCompleted')).toHaveLength(1)
  expect(result.state.slots.filter(s => s.monster)).toHaveLength(1)
})
it('mother without surviving cocoon is inert; an unidentified boss is not assumed ordinary', () => {
  const s = state(2); expect(run('mother', s).state.slots).toEqual(s.slots)
  Object.assign(s.slots[0].monster!, { monsterId: 'unresolved:swarm:boss', rarity: 'boss' })
  expect(() => run('mother', s)).toThrow('身份未确认')
  s.slots[0].monster!.monsterId = 'class:swarm:boss'
  expect(run('mother', s).state.slots).toEqual(s.slots)
})
it('mother does not invent fractional rounding', () => {
  const s = state(); Object.assign(s.slots[0].monster!, { monsterId: cocoonId, rarity: 'boss', quantity: 101 })
  expect(() => run('mother', s)).toThrow('取整')
})
it('communion uses removed sums, independent random rarities, no birth base dependency', () => {
  const rolls = [.01, .3, .55, .99, .3, .01]
  const m = conf(); delete m.rarityBases
  const result = run('communion', state(2), m, () => rolls.shift()!)
  expect(result.state.slots.map(s => s.monster!.rarity)).toEqual(['common','magic','rare','boss','magic','common'])
  result.state.slots.forEach(s => expect(s.monster).toMatchObject({ race: 'awakened', quantity: 200, unitActivity: 40 }))
  expect(result.events.map(e => e.type).slice(0,5)).toEqual(['cardPlayed','removeSucceeded','removeSucceeded','addAttempted','addSucceeded'])
})
it('communion settles removal passives against new monsters, not the empty intermediate board', () => {
  const s = state(2); s.persistentEffects = [runtime('contracting-claw')]
  // Use the catalog's stable ID, not a similarly named hypothetical effect.
  s.persistentEffects[0].cardId = implementedPersistent.find(p => p.name === '挛缩指爪')!.id
  const result = run('communion', s)
  expect(result.state.slots[0].monster!.quantity).toBe(500)
  expect(result.state.slots.slice(1).map(s => s.monster!.quantity)).toEqual([200,200,200,200,200])
})
it('disease uses confirmed boss bases for spawning and refuses unconfirmed full-board upgrade deltas', () => {
  const result = run('disease')
  expect(result.state.slots[1].monster).toMatchObject({ race: 'construct', rarity: 'boss', ...bases.boss })
  expect(result.state.specialOffer?.count).toBe(1)
  expect(() => run('disease', state(6))).toThrow('增量/成长保留公式未知')
})
it('skeleton removes others, adds boss then random constructors, and gives immediate count-scaled growth', () => {
  const s = state(3); s.slots[1].monster!.race = 'construct'
  const rolls = [.01,.3,.55,.99]
  const result = run('skeleton', s, conf(), () => rolls.shift()!)
  expect(result.state.slots.map(s => s.monster!.race)).toEqual(Array(6).fill('construct'))
  expect(result.state.slots[1].monster).toMatchObject({ quantity: 1294, unitActivity: 1214 })
  expect(result.state.slots[0].monster).toMatchObject({ rarity: 'boss', quantity: 1234, unitActivity: 1202 })
  expect(result.state.slots.slice(2).map(s => s.monster!.rarity)).toEqual(rarityIds)
  expect(result.events.some(e => e.type === 'roundEnd')).toBe(false)
})
it('full-construct skeleton still grants immediate bonuses without needing spawn values', () => {
  const s = state(6); s.slots.forEach(s => { s.monster!.race = 'construct' })
  const m = conf(); delete m.rarityBases
  const result = run('skeleton', s, m)
  result.state.slots.forEach(s => expect(s.monster).toMatchObject({ quantity: 1294, unitActivity: 1214 }))
  expect(result.events.filter(e => e.type === 'addFailedBoardFull')).toHaveLength(1)
})

const offerModel = (): PlannerModel => {
  const m = conf()
  m.cards.push(...['a','b','c','extra1','extra2'].map(id => ({ id, name: id, effects: [] })))
  m.offerPool = ['a','b','c']; m.offerCount = 3
  m.specialOfferPools = Object.fromEntries(['swarm-generation-1','swarm-generation-2','swarm-generation-3','swarm-mother','construct-dissection-1']
    .map(id => [id, [{ cardId: 'extra1', weight: 3 }, { cardId: 'extra2', weight: 1 }]]))
  return m
}
it('next offer adds two specials to three ordinary cards, even when obtaining cocoon failed', () => {
  const s = state(6); s.offeredCardIds = [rule('cocoon').id]
  const r = simulateAction(s, { type: 'playCard', cardId: rule('cocoon').id, selectedSlotIds: [] }, offerModel(), seededRandom(2))
  expect(r.state.offeredCardIds).toHaveLength(5)
  expect(new Set(r.state.offeredCardIds)).toEqual(new Set(['a','b','c','extra1','extra2']))
  expect(r.state.round).toBe(5)
})
it('one extra yields four candidates; picking ordinary cancels the prior special chain', () => {
  const m = offerModel(), s = state()
  s.offeredCardIds = [rule('copy3').id]
  const first = simulateAction(s, { type: 'playCard', cardId: rule('copy3').id, selectedSlotIds: [] }, m, () => 0).state
  expect(first.offeredCardIds).toHaveLength(4)
  const second = simulateAction(first, { type: 'playCard', cardId: 'a', selectedSlotIds: [] }, m, () => 0).state
  expect(second.offeredCardIds).toHaveLength(3)
  expect(second.specialOffer).toBeUndefined()
})
it('unknown special distribution blocks future search, never converts high chance into a fixed outcome', () => {
  const s = state(6); s.offeredCardIds = [rule('cocoon').id]
  expect(() => simulateAction(s, { type: 'playCard', cardId: rule('cocoon').id, selectedSlotIds: [] }, conf(), () => 0)).toThrow('概率未知')
})
it('replace and additional are distinct; malformed weights/pools fail closed', () => {
  const s = state(); s.specialOffer = { mode: 'replace', count: 1, poolId: 'swarm-mother' }
  expect(drawOffer(s, offerModel(), () => 0)).toEqual(['extra1'])
  const m = offerModel(); m.specialOfferPools!['swarm-mother'][0].weight = -1
  expect(() => drawOffer(s, m, () => 0)).toThrow('非法权重')
  s.specialOffer.count = 3
  expect(() => drawOffer(s, offerModel(), () => 0)).toThrow('不足')
})
it('the final drafting round does not spawn special candidates during surgery choices', () => {
  const s = state(6); s.round = 10; s.offeredCardIds = [rule('cocoon').id]
  const r = simulateAction(s, { type: 'playCard', cardId: rule('cocoon').id, selectedSlotIds: [] }, conf(), () => 0)
  expect(r.state.offeredCardIds).toEqual([]); expect(r.state.specialOffer).toBeUndefined()
})
it('desktop shares special mechanics, keeps observed board untouched, and exposes next-offer limits', () => {
  const source: GameState = { round: 4, mode: 'activity', monsters: state().slots.map(s => ({ id: s.slotId,
    race: s.monster?.race ?? null, rarity: s.monster?.rarity ?? 'common', quantity: s.monster?.quantity ?? 0, unitActivity: s.monster?.unitActivity ?? 0 })) }
  const card = candidateCards.find(c => c.id === rule('copy1').id)!
  const result = rankCards(source, [card], [])[0]
  expect(result.activityAfter).toBe(4400); expect(result.state).toEqual(source)
  expect(result.trace.join()).toContain('后续价值不计入本轮评分')
  expect(result.requiresOutcomeSync).toBe(true)
  expect(asPlannerMonster({ ...source.monsters[0], rarity: 'boss', specialIdentity: 'hollow-cocoon' }).monsterId).toBe(cocoonId)
})
it('special bases parse independently, reject invalid values, and do not alter ordinary rarity bases', () => {
  const data = { specialBases: { hollowCocoon: { quantity: 17, unitActivity: 23 } } }
  expect(parsePersistentModel(JSON.stringify(data))).toEqual(data)
  expect(() => parsePersistentModel('{"specialBases":{"hollowCocoon":{"quantity":0,"unitActivity":1}}}')).toThrow('正整数')
  expect(() => parsePersistentModel('{"specialBases":{"anything":{}}}')).toThrow('hollowCocoon')
})
