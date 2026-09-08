import { describe, expect, it } from 'vitest'
import { implementedPersistent } from './persistentCatalog'
import { createPlannerModel, modelCoverage } from './catalog'
import { resolvePersistentEvents, simulateAction } from './simulator'
import { board, monster, model, runtime } from './fixtures.test-support'
import { raceIds, rarityIds } from '../types/game'
import type { GameEvent, Monster, SimulationResult } from './types'
import { realCardCatalog } from '../data/realCardCatalog'

const m = (race: Monster['race'] = 'swarm', rarity: Monster['rarity'] = 'common', quantity = 10, unitActivity = 10) =>
  monster({ race, rarity, quantity, unitActivity })
function scenario(id: string, monsters: Monster[], round = 12) {
  return board({ round, slots: Array.from({ length: 6 }, (_, i) => ({ slotId: `slot-${i + 1}`,
    monster: monsters[i] ? { ...monsters[i], instanceId: `instance-${i + 1}` } : null })), persistentEffects: [runtime(id)] })
}
function rules() {
  return { ...model(), persistent: implementedPersistent,
    monsters: raceIds.flatMap(race => rarityIds.map(rarity => ({ monsterId: `${race}-${rarity}`, race, rarity, quantity: 12, unitActivity: 15 }))),
  }
}
const end = (round = 12): GameEvent => ({ type: 'roundEnd', source: 'round', round })
const event = (type: GameEvent['type'], before = m('swarm'), after = m('swarm')): GameEvent =>
  ({ type, source: 'test', round: 12, slotId: 'slot-1', before, after })
const live = (result: SimulationResult) => result.state.slots.flatMap(s => s.monster ? [s.monster] : [])
const run = (id: string, monsters: Monster[], events = [end()]) => {
  const state = scenario(id, monsters)
  const saved = structuredClone(state)
  const result = resolvePersistentEvents(state, events, rules(), () => 0)
  expect(state).toEqual(saved)
  expect(result.state.slots).toHaveLength(6)
  return result
}

describe('24 real permanent effects', () => {
  const cases: Array<[string, Monster[], GameEvent[] | undefined, (r: SimulationResult) => void]> = [
    ['human-pupa', [m()], undefined, r => expect(live(r)[0].quantity).toBe(18)],
    ['hatching-sac', [m(), m()], [event('addSucceeded')], r => expect(live(r).map(m => m.quantity)).toEqual([55,55])],
    ['proliferating-frontal-lobe', [m('awakened'),m('awakened'),m('construct','rare')], undefined,
      r => expect(live(r).map(m => m.unitActivity)).toEqual([10,10,90])],
    ['hypertrophic-pituitary', [m('awakened','boss'),m('swarm')], undefined,
      r => expect(live(r).map(m => m.unitActivity)).toEqual([90,10])],
    ['adhesive-metatarsal', [m('construct'),m('construct')], [event('removeSucceeded')],
      r => expect(live(r)[0].quantity).toBe(190)],
    ['contracted-claw', [m('construct')], [event('removeSucceeded')], r => expect(live(r)[0].quantity).toBe(160)],
    ['aberrant-bud', [m('aberrant'),m()], [event('mutationCompleted',m(),m('aberrant'))],
      r => expect(live(r).map(m => m.unitActivity)).toEqual([45,45])],
    ['mottled-liver', [m('aberrant'),m('aberrant'),m()], [event('mutationCompleted')],
      r => expect(live(r).map(m => m.unitActivity)).toEqual([30,30,30])],
    ['clustered-insect-eggs', [m(),m(),m()], undefined, r => {
      expect(live(r)).toHaveLength(4); expect(live(r)[3]).toMatchObject({race:'swarm',quantity:112,unitActivity:15})
    }],
    ['molting-cortex', [m('construct','magic'),m('swarm','magic')], undefined, r => {
      expect(live(r)).toHaveLength(1); expect(live(r)[0]).toMatchObject({race:'awakened',rarity:'rare',quantity:20,unitActivity:20})
      expect(r.events.filter(e => e.type === 'removeSucceeded')).toHaveLength(2)
      expect(r.events.filter(e => e.type === 'fusionCompleted')).toHaveLength(1)
    }],
    ['beast-tendon-cord', [m('construct'),m('construct'),m('swarm','common',5,4)], undefined,
      r => { expect(live(r)).toHaveLength(2); expect(live(r)[0]).toMatchObject({quantity:15,unitActivity:14}) }],
    ['writhing-spinal', [m()], [event('addSucceeded',m(),monster({instanceId:'instance-1'}))],
      r => expect(live(r)[0]).toMatchObject({race:'aberrant',unitActivity:90})],
    ['leather-restraint', [m('swarm','magic',11),m('construct','magic'),m('awakened','magic')], undefined,
      r => expect(live(r).map(m => m.quantity)).toEqual([111,10,10])],
    ['black-goat-suture', [m(),m(),m()], undefined, r => {
      expect(live(r)).toHaveLength(1); expect(live(r)[0]).toMatchObject({rarity:'magic',quantity:30,unitActivity:30})
    }],
    ['iron-bone-saw', [m('swarm','common',151,151),m('swarm','common',150,151),m('swarm','common',151,150)], undefined,
      r => expect(live(r).map(m => [m.quantity,m.unitActivity])).toEqual([[166,166],[150,151],[151,150]])],
    ['two-inch-skull-nail', [m('swarm','common',1,1),m('construct')], [event('addFailedBoardFull')],
      r => expect(live(r)[0]).toMatchObject({quantity:26,unitActivity:26})],
    ['dirty-bone-scraper', [m('swarm','common',276),m('swarm','common',275)], undefined,
      r => expect(live(r).map(m => m.unitActivity)).toEqual([30,10])],
    ['canine-rasp', [m('swarm','common',10,256),m('swarm','common',10,255)], undefined,
      r => expect(live(r).map(m => m.quantity)).toEqual([40,10])],
    ['plague-madonna', rarityIds.map(r => m('swarm',r)), undefined,
      r => { expect(live(r).map(m => m.rarity)).toEqual(['magic','rare','boss','boss']); expect(r.events.filter(e => e.type === 'mutationCompleted')).toHaveLength(3) }],
    ['alien-sting', [m(),m('construct','boss')], undefined,
      r => { expect(live(r).map(m => m.race)).toEqual(['awakened','awakened']); expect(live(r)[1].rarity).toBe('boss') }],
    ['tanned-leather-restraint', ['common','magic','boss'].map(r => m('swarm',r as Monster['rarity'])), undefined,
      r => expect(live(r).map(m => m.unitActivity)).toEqual([30,30,30])],
    ['eyelid-dilator', [m('swarm','common',11),m()], [event('removeSucceeded')],
      r => expect(live(r)[0]).toMatchObject({quantity:31,unitActivity:30})],
    ['second-born-beak', [m(),m()], undefined, r => expect(live(r)).toHaveLength(3)],
    ['nettle-loop', [m(),m(),m(),m('swarm','magic')], undefined,
      r => expect(live(r).map(m => m.quantity)).toEqual([40,40,40,40])],
  ]
  it.each(cases)('%s performs its card-text effect', (id, monsters, events, verify) => verify(run(id,monsters,events)))
  it('covers every real card exactly once, with stable IDs and executable triggers', () => {
    const names = realCardCatalog.filter(c => c.category === '手术用具').map(c => c.name).sort()
    expect(implementedPersistent.map(p => p.name).sort()).toEqual(names)
    expect(new Set(implementedPersistent.map(p => p.id)).size).toBe(24)
    expect(cases.map(c => c[0]).sort()).toEqual(implementedPersistent.map(p => p.id).sort())
    expect(modelCoverage(createPlannerModel()).persistent.filter(p => p.status === 'implemented')).toHaveLength(24)
  })
  it('checks every conditional card when the board is below its threshold', () => {
    for (const id of ['hatching-sac','proliferating-frontal-lobe','hypertrophic-pituitary','adhesive-metatarsal',
      'mottled-liver','clustered-insect-eggs','molting-cortex','beast-tendon-cord','leather-restraint','black-goat-suture',
      'iron-bone-saw','dirty-bone-scraper','canine-rasp','tanned-leather-restraint','second-born-beak','nettle-loop']) {
      const state = scenario(id,[m('construct')])
      const events = [event('addSucceeded'),event('removeSucceeded'),event('mutationCompleted'),end()]
      expect(resolvePersistentEvents(state,events,rules(),()=>0).state.slots, id).toEqual(state.slots)
    }
  })
  it('does not grow on failed addition; skull nail triggers once for each overflow', () => {
    const state = scenario('hatching-sac',Array.from({length:6},()=>m()))
    state.persistentEffects.push(runtime('two-inch-skull-nail'))
    const engine = rules()
    engine.cards = [{id:'add',name:'add',effects:[{type:'add',count:2,spec:{}}]}]
    state.round = 10; state.offeredCardIds = ['add']
    const result = simulateAction(state,{type:'playCard',cardId:'add',selectedSlotIds:[]},engine,()=>0)
    expect(result.events.filter(e=>e.type==='addFailedBoardFull')).toHaveLength(2)
    expect(result.events.filter(e=>e.type==='addSucceeded')).toHaveLength(0)
    expect(live(result).map(m=>m.quantity)).toEqual([35,35,10,10,10,10])
  })
  it('beak full-board devouring excludes the victim from tied recipients and emits only removal', () => {
    const r = run('second-born-beak',Array.from({length:6},()=>m()))
    expect(live(r)).toHaveLength(5)
    expect(live(r)[0]).toMatchObject({quantity:20,unitActivity:20})
    expect(r.events.filter(e=>e.type==='removeSucceeded')).toHaveLength(1)
    expect(r.events.some(e=>e.type==='addSucceeded')).toBe(false)
  })
  it('black goat resolves every available triple and never merges bosses', () => {
    expect(live(run('black-goat-suture',Array.from({length:6},()=>m())))).toHaveLength(2)
    expect(live(run('black-goat-suture',Array.from({length:3},()=>m('swarm','boss'))))).toHaveLength(3)
  })
  it('chains removal → transfer bonus, addition → mutation → global bonuses', () => {
    const state = scenario('molting-cortex',[m('swarm','magic'),m('construct','magic')])
    state.persistentEffects.push(runtime('contracted-claw'),runtime('writhing-spinal'),runtime('aberrant-bud'))
    const r = resolvePersistentEvents(state,[end()],rules(),()=>0)
    expect(live(r)[0]).toMatchObject({race:'aberrant',quantity:170,unitActivity:135})
  })
  it('does not trigger a newly acquired permanent until the following round; still settles rounds 11–13', () => {
    let state = scenario('dirty-bone-scraper',[m('construct','common',300)],10)
    state.persistentEffects = [runtime('dirty-bone-scraper',10)]
    state = simulateAction(state,{type:'playCard',cardId:'noop',selectedSlotIds:[]},rules(),()=>0).state
    expect(state.slots[0].monster!.unitActivity).toBe(10)
    for(let round=11;round<=13;round++) state=simulateAction(state,{type:'advanceSurgeryPlanRound'},rules(),()=>0).state
    expect(state.round).toBe(14); expect(state.slots[0].monster!.unitActivity).toBe(70)
  })
  it('uses an explicit repetition interpretation and checks periodic off-rounds', () => {
    const s=scenario('human-pupa',[m()])
    expect(resolvePersistentEvents(s,[end()],{...rules(),pupaRepetitions:'additionalX'},()=>0).state.slots[0].monster!.quantity).toBe(26)
    for(const id of ['plague-madonna','alien-sting']) {
      const state=scenario(id,[m()],11)
      expect(resolvePersistentEvents(state,[end(11)],rules(),()=>0).state.slots).toEqual(state.slots)
    }
  })
  it('blocks missing generation, random fusion identity and rarity transition data', () => {
    for(const [id,monsters] of [['clustered-insect-eggs',[m(),m(),m()]],['black-goat-suture',[m(),m(),m()]],
      ['plague-madonna',[m()]],['alien-sting',[m()]],['second-born-beak',[m(),m()]]] as Array<[string,Monster[]]>) {
      expect(()=>resolvePersistentEvents(scenario(id,monsters),[end()],{...model(),persistent:implementedPersistent},()=>0)).toThrow()
    }
  })
})
