import { describe, expect, it } from 'vitest'
import { board, model, monster, play, runtime } from './fixtures.test-support'
import { finalActivity, getLegalActions, simulateAction, drawOffer, validateState } from './simulator'
import { seededRandom } from './random'
import { createPlannerModel } from './catalog'
import { fromLegacyState } from './observations'
import { observedRun } from '../data/observedRun'

describe('workflow simulator', () => {
  it('uses quantity × activity with no rarity multiplier', () => {
    const s = board(); s.slots[0].monster = monster({ rarity: 'boss' })
    expect(finalActivity(s)).toBe(100)
  })
  it('validates fixed slots, positive integers and unique instances', () => {
    expect(() => validateState(board({ slots: [] }))).toThrow()
    const s = board(); s.slots[1].monster = monster()
    expect(() => validateState(s)).toThrow('实例')
    s.slots[1].monster = null; s.slots[0].monster!.quantity = .5
    expect(() => validateState(s)).toThrow('正整数')
  })
  it('enumerates all choose-one-or-two targets, but never lets the player pick a random target', () => {
    const s = board({ offeredCardIds: ['choose', 'random'] })
    s.slots[1].monster = monster({ instanceId: 'two' })
    const m = model([
      { id: 'choose', name: 'choose', targeting: { mode: 'choose', min: 1, max: 2 }, effects: [] },
      { id: 'random', name: 'random', targeting: { mode: 'random', min: 1, max: 1 }, effects: [] },
    ])
    expect(getLegalActions(s, m)).toEqual([play('choose', ['slot-1']), play('choose', ['slot-2']),
      play('choose', ['slot-1', 'slot-2']), play('random')])
    expect(() => simulateAction(s, play('random', ['slot-1']), m, seededRandom(1))).toThrow('非法')
  })
  it('keeps input immutable and refills the first empty slot in physical order', () => {
    const m = model([{ id: 'add', name: 'add', effects: [
      { type: 'add', count: 1, spec: { base: monster() } },
    ] }])
    const s = board({ offeredCardIds: ['add'] })
    s.slots[3].monster = s.slots[0].monster; s.slots[0].monster = null
    const original = structuredClone(s), result = simulateAction(s, play('add'), m, seededRandom(1))
    expect(s).toEqual(original)
    expect(result.state.slots[0].monster).not.toBeNull()
    expect(result.state.slots[3].monster?.instanceId).toBe('instance-1')
  })
  it('emits one removal and only one successful addition when six slots delete one then add two', () => {
    const s = board({ offeredCardIds: ['split'] })
    s.slots.forEach((slot, i) => { slot.monster = monster({ instanceId: 'm' + i }) })
    const m = model([{ id: 'split', name: 'split', targeting: { mode: 'choose', min: 1, max: 1 }, effects: [
      { type: 'remove', target: { mode: 'selected' } },
      { type: 'add', count: 2, spec: { base: monster() } },
    ] }])
    const { events, state } = simulateAction(s, play('split', ['slot-3']), m, seededRandom(1))
    expect(events.map(e => e.type)).toEqual(['cardPlayed', 'removeSucceeded', 'addAttempted', 'addSucceeded',
      'addAttempted', 'addFailedBoardFull', 'roundEnd'])
    expect(state.slots.filter(s => s.monster)).toHaveLength(6)
  })
  it('full-board failures trigger dedicated effects, never successful-add effects or missing base lookups', () => {
    const s = board({ offeredCardIds: ['add'], persistentEffects: [runtime('full'), runtime('success')] })
    s.slots.forEach((slot, i) => { slot.monster = monster({ instanceId: 'm' + i }) })
    const m = model([{ id: 'add', name: 'add', effects: [{ type: 'add', count: 2, spec: {} }] }])
    m.persistent = [
      { id: 'full', name: 'full', triggers: [{ event: 'addFailedBoardFull', effects: [{ type: 'stats', target: { mode: 'all' }, quantity: 1 }] }] },
      { id: 'success', name: 'success', triggers: [{ event: 'addSucceeded', effects: [{ type: 'stats', target: { mode: 'all' }, quantity: 1000 }] }] },
    ]
    const result = simulateAction(s, play('add'), m, seededRandom(1))
    expect(finalActivity(result.state)).toBe(720)
    expect(result.state.persistentEffects.map(p => p.triggerCount)).toEqual([2, 0])
  })
  it('fusion sums both stats, emits 2 removals/1 addition/1 fusion, and resolves per-removal bonuses', () => {
    const s = board({ offeredCardIds: ['fuse'], persistentEffects: [runtime('contracted-claw')] })
    s.slots[1].monster = monster({ instanceId: 'two', quantity: 20, unitActivity: 20 })
    const m = createPlannerModel({ cards: [{ id: 'fuse', name: 'fuse', targeting: { mode: 'choose', min: 2, max: 2 },
      effects: [{ type: 'fuse', race: 'swarm' }] }] })
    const result = simulateAction(s, play('fuse', ['slot-1', 'slot-2']), m, () => 0)
    expect(finalActivity(result.state)).toBe(330 * 30)
    expect(result.events.filter(e => e.type === 'removeSucceeded')).toHaveLength(2)
    expect(result.events.filter(e => e.type === 'addSucceeded')).toHaveLength(1)
    expect(result.events.filter(e => e.type === 'fusionCompleted')).toHaveLength(1)
  })
  it('race-only mutation retains slot and stats, never emits removal/addition', () => {
    const s = board({ offeredCardIds: ['mutate'] })
    const m = model([{ id: 'mutate', name: 'm', effects: [{ type: 'mutate', target: { mode: 'all' }, race: 'construct' }] }])
    const result = simulateAction(s, play('mutate'), m, seededRandom(1))
    expect(result.state.slots[0].monster).toMatchObject({ quantity: 10, unitActivity: 10, race: 'construct', instanceId: 'instance-1' })
    expect(result.events.map(e => e.type)).toEqual(['cardPlayed', 'mutationCompleted', 'roundEnd'])
  })
  it('boss rarity never upgrades or downgrades', () => {
    const s = board({ offeredCardIds: ['mutate'] }); s.slots[0].monster!.rarity = 'boss'
    const m = model([{ id: 'mutate', name: 'm', effects: [{ type: 'mutate', target: { mode: 'all' }, rarity: 'common' }] }])
    expect(simulateAction(s, play('mutate'), m, seededRandom(1)).state.slots[0].monster?.rarity).toBe('boss')
  })
  it('missing rarity data is unavailable instead of zero gain or unchanged stats', () => {
    const s = board({ offeredCardIds: ['mesmerizing-tincture'] })
    expect(() => simulateAction(s, play('mesmerizing-tincture', ['slot-1']), createPlannerModel(), seededRandom(1)))
      .toThrow('缺少 common→magic')
  })
  it('delays new equipment and still triggers it on rounds 11,12,13', () => {
    const s = board({ offeredCardIds: ['equip'] }); s.slots[0].monster!.quantity = 280
    const m = createPlannerModel({ cards: [{ id: 'equip', name: 'equip', effects: [], acquirePersistentId: 'dirty-bone-scraper' }] })
    let result = simulateAction(s, play('equip'), m, seededRandom(1))
    expect(result.state.slots[0].monster!.unitActivity).toBe(10)
    for (let round = 11; round <= 13; round++) {
      expect(getLegalActions(result.state, m)).toEqual([{ type: 'advanceSurgeryPlanRound' }])
      result = simulateAction(result.state, { type: 'advanceSurgeryPlanRound' }, m, seededRandom(1))
    }
    expect(result.state.round).toBe(14)
    expect(finalActivity(result.state)).toBe(280 * 70)
    expect(result.state.persistentEffects[0].triggerCount).toBe(3)
    expect(getLegalActions(result.state, m)).toEqual([])
  })
  it('redraw spends one resource in the same round without settlement', () => {
    const s = board({ redrawsRemaining: 1, persistentEffects: [runtime('dirty-bone-scraper')] })
    s.slots[0].monster!.quantity = 280
    const m = createPlannerModel({ cards: model().cards, offerPool: ['noop'], offerCount: 1 })
    const result = simulateAction(s, { type: 'redraw' }, m, seededRandom(1))
    expect(result.state.round).toBe(10); expect(result.state.redrawsRemaining).toBe(0)
    expect(result.events).toEqual([]); expect(finalActivity(result.state)).toBe(2800)
    expect(() => simulateAction(result.state, { type: 'redraw' }, m, seededRandom(1))).toThrow('非法')
  })
  it('filters special stages before uniform drawing', () => {
    const s = board({ round: 9, offeredCardIds: ['first'] })
    const m = model([
      { id: 'first', name: 'first', eligibility: { stage: 0 }, nextStage: 1, effects: [] },
      { id: 'second', name: 'second', eligibility: { stage: 1 }, effects: [] },
    ])
    const after = simulateAction(s, play('first'), m, seededRandom(1)).state
    expect(after.specialPotionStage).toBe(1); expect(after.offeredCardIds).toEqual(['second'])
  })
  it('does not shrink an undersized pool silently', () => {
    const m = model(); m.offerCount = 3
    expect(() => drawOffer(board(), m, seededRandom(1))).toThrow('牌池不足')
  })
  it('resolves adding -> probabilistic mutation -> mutation passive as distinct events', () => {
    const s = board({ offeredCardIds: ['add'], persistentEffects: [runtime('writhing-spinal'), runtime('aberrant-bud')] })
    const m = createPlannerModel({ cards: [{ id: 'add', name: 'add',
      effects: [{ type: 'add', count: 1, spec: { base: monster({ quantity: 1, unitActivity: 5 }) } }] }] })
    const result = simulateAction(s, play('add'), m, () => 0)
    expect(result.state.slots[1].monster).toMatchObject({ race: 'aberrant', quantity: 1, unitActivity: 120 })
    expect(result.state.slots[0].monster!.unitActivity).toBe(45)
  })
  it('does not apply a stale add event to a different monster that reused the slot', () => {
    const s = board({ offeredCardIds: ['replace'], persistentEffects: [runtime('writhing-spinal')] })
    s.slots[0].monster = null
    const m = createPlannerModel({ cards: [{ id: 'replace', name: 'replace', effects: [
      { type: 'add', count: 1, spec: { base: monster() } },
      { type: 'remove', target: { mode: 'all' } },
      { type: 'add', count: 1, spec: { base: monster() } },
    ] }] })
    const result = simulateAction(s, play('replace'), m, () => 0)
    expect(result.state.slots[0].monster!.unitActivity).toBe(90)
  })
  it('rejects unbounded recursive add-failure chains', () => {
    const s = board({ persistentEffects: [runtime('cycle')] })
    s.slots.forEach((slot, i) => { slot.monster = monster({ instanceId: 'm' + i }) })
    const m = model(); m.maxEvents = 20
    m.persistent = [{ id: 'cycle', name: 'cycle', triggers: [
      { event: 'roundEnd', effects: [{ type: 'add', count: 1, spec: {} }] },
      { event: 'addFailedBoardFull', effects: [{ type: 'add', count: 1, spec: {} }] },
    ] }]
    expect(() => simulateAction(s, play(), m, () => 0)).toThrow('事件链超过')
  })
  it('rejects fractional results instead of inventing rounding', () => {
    const m = model([{ id: 'half', name: 'half', effects: [{ type: 'stats', target: { mode: 'all' }, activityFactor: 1.05 }] }])
    expect(() => simulateAction(board({ offeredCardIds: ['half'] }), play('half'), m, () => 0)).toThrow('正整数')
  })
})

describe('real observed transitions', () => {
  const ids = ['round-5-digestive-enzyme-and-dirty-bone-scraper', 'round-8-digestive-enzyme-and-dirty-bone-scraper',
    'round-10-birth-bone-powder-and-dirty-bone-scraper']
  it.each(ids)('replays %s against stored screenshot arithmetic', id => {
    const sample = observedRun.find(s => s.id === id)!
    const state = fromLegacyState(sample.before, {
      persistentEffects: sample.persistentCardIds.map(id => runtime(id)), offeredCardIds: [sample.chosenCardId],
      redrawsRemaining: 0, specialPotionStage: 0,
    })
    const m = createPlannerModel({ offerPool: ['soft-meningeal-solution'], offerCount: 1 })
    const randomTarget = sample.chosenCardId === 'birth-bone-powder'
    const result = simulateAction(state, play(sample.chosenCardId, randomTarget ? [] : sample.context.selectedMonsterIds), m, () => 0)
    expect(finalActivity(result.state)).toBe(sample.displayedFinalActivity)
    expect(result.state.slots.map(s => s.monster && [s.monster.race, s.monster.rarity, s.monster.quantity, s.monster.unitActivity]))
      .toEqual(sample.after.monsters.map(m => m.race && [m.race, m.rarity, m.quantity, m.unitActivity]))
  })
})
