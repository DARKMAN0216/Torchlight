import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { candidateCards, persistentCards } from '../data/sampleLibrary'
import { realCardCatalog } from '../data/realCardCatalog'
import { evaluateCard, rankCards } from './evaluate'
import { estimateRedraw } from './redraw'
import { mergeRecognitionSnapshot } from '../recognition/merge'
import { CandidateCardView } from '../components/CandidateCardView'
import type { GameState, RaceId } from '../types/game'
const card = (id: string) => candidateCards.find(c => c.id === id)!
const state = (...races: RaceId[]): GameState => ({ round: 7, mode: 'activity',
  monsters: Array.from({length:6},(_,i)=>({id:`slot-${i+1}`,race:races[i]??null,rarity:'common',quantity:races[i]?10:0,unitActivity:races[i]?100:0})) })
const project = (id: string, s: GameState, loadout = [] as typeof persistentCards) =>
  evaluateCard(s, card(id), loadout, {selectedMonsterIds:['slot-1']})
describe('potion ranges', () => {
  it('exorcise without a victim keeps both unresolved activation branches', () => {
    expect(project('exorcising-powder',state('swarm')).activityRange)
      .toEqual({minimum:1000,maximum:13700})
    expect(project('exorcising-powder',state('swarm','construct')).activityRange)
      .toEqual({minimum:13700,maximum:13700})
  })
  it('catalog rare box opens three offers without claiming rare-only odds', () => {
    expect(card('rare-potion-box-catalog')).toMatchObject({name:'稀有药剂箱',followUpOfferCount:3})
    expect(card('rare-potion-box-catalog').evaluationUnavailable).not.toBe(true)
  })
  it('egg requires explicit baseline, handles empty/full boards, and respects six slots', () => {
    const egg=card('active-oviposition-hormone')
    expect(rankCards(state('swarm'),[egg],[])[0].modelUnavailable).toContain('rarityBases')
    expect(evaluateCard(state('swarm'),egg,[]).modelUnavailable).toContain('rarityBases')
    const rarityBases={common:{quantity:36,unitActivity:1},magic:{quantity:36,unitActivity:1},rare:{quantity:36,unitActivity:1},boss:{quantity:36,unitActivity:1}}
    const s={...state(),persistentModel:{rarityBases}}
    expect(project('active-oviposition-hormone',s).activityRange).toEqual({minimum:36,maximum:108})
    const full={...state('swarm','swarm','swarm','swarm','swarm','swarm')}
    expect(project('active-oviposition-hormone',full).activityRange).toEqual({minimum:6000,maximum:6000})
    expect(project('active-oviposition-hormone',s).state.monsters).toHaveLength(6)
    expect(rankCards({...state(),newbornSwarm:{rarity:'common',quantity:36,unitActivity:1}},[egg],[])[0].modelUnavailable).toContain('rarityBases')
  })
  it('egg enumerates actual on-add mutation outcomes and never multiplies its base as an additive gain', () => {
    const s={...state(),persistentModel:{rarityBases:{common:{quantity:36,unitActivity:1},magic:{quantity:36,unitActivity:1},rare:{quantity:36,unitActivity:1},boss:{quantity:36,unitActivity:1}}}}
    const writhing=persistentCards.filter(c=>c.id==='writhing-spinal')
    expect(project('active-oviposition-hormone',s,writhing).activityRange).toEqual({minimum:36,maximum:8748})
    expect(project('active-oviposition-hormone',s,persistentCards.filter(c=>c.id==='raging-blood')).modelUnavailable)
      .toContain('旧示例效果')
  })
  it('matches all 60 potion names and the three reported names', () => {
    const potions=realCardCatalog.filter(c=>c.category!=='手术用具')
    expect(potions).toHaveLength(60)
    for(const entry of potions) expect(candidateCards.some(c=>c.name===entry.name)).toBe(true)
    const merged=mergeRecognitionSnapshot(state('construct','swarm'), [], 3, {
      capturedAt:'now',phase:{value:'potionSelection',confidence:1},candidateCardIds:[],
      candidateCardNames:['清疽油膏','纯粹活蛭溶液','鲜脊髓药粉'].map(value=>({value,confidence:1})),
    },candidateCards)
    expect(merged.unmatchedCandidateNames).toEqual([])
    expect(merged.confirmedCandidateIds).toEqual(['cleansing-ointment','pure-live-leech-solution','fresh-spinal-powder'])
  })
  it('cleansing includes right-neighbor loss and leaves source/slots intact', () => {
    const s=state('construct','swarm'), r=project('cleansing-ointment',s)
    expect(r.activityRange).toEqual({minimum:6120,maximum:6120})
    expect(r.state.monsters[0]).toMatchObject({quantity:51,unitActivity:120})
    expect(r.state.monsters[1]).toMatchObject({race:null,quantity:0,unitActivity:0})
    expect(r.state.monsters).toHaveLength(6);expect(s.monsters[1].race).toBe('swarm')
    expect(project('cleansing-ointment',state('swarm','construct')).delta).toBe(200)
  })
  it('empty neighbor does not skip and the rightmost slot still gets bonuses', () => {
    const s=state('construct');s.monsters[2]={...s.monsters[0],id:'slot-3',race:'swarm'}
    expect(project('cleansing-ointment',s).state.monsters[2].race).toBe('swarm')
    s.monsters[5]={...s.monsters[0],id:'slot-6'}
    expect(evaluateCard(s,card('cleansing-ointment'),[],{selectedMonsterIds:['slot-6']}).delta).toBe(5120)
  })
  it('enumerates two removal passives', () => {
    const r=project('cleansing-ointment',state('construct','swarm','construct'),
      persistentCards.filter(c=>['contracted-claw','adhesive-metatarsal'].includes(c.id)))
    expect(r.activityRange).toEqual({minimum:40120,maximum:46720})
    expect(r.warnings.some(w=>w.includes('需要记录'))).toBe(false)
  })
  it('leech only chooses anchor; second recipient is not assumed controllable', () => {
    const s=state('swarm','swarm','swarm');s.monsters[1].quantity=20;s.monsters[2].quantity=30
    expect(project('pure-live-leech-solution',s).activityRange).toEqual({minimum:6930,maximum:7550})
    expect(project('pure-live-leech-solution',state('swarm')).activityRange).toEqual({minimum:1000,maximum:1310})
    expect(rankCards(s,[card('pure-live-leech-solution')],[])[0].recommendedTargetIds).toHaveLength(1)
  })
  it('fresh includes mutation and quantity synergy with explicit outer bounds', () => {
    const r=project('fresh-spinal-powder',state('swarm','construct','awakened'),persistentCards.filter(c=>c.id==='aberrant-bud'))
    expect(r.activityRange).toEqual({minimum:3000,maximum:83640})
    expect(r.card.evaluationUnavailable).toBe(false);expect(r.card.requiresScreenSync).toBe(true)
    expect(r.trace.join(' ')).toContain('外包范围')
  })
  it('birth bone includes extra127 and removal', () => {
    expect(project('birth-bone-powder',state('construct','swarm')).activityRange).toEqual({minimum:17700,maximum:17700})
  })
  it('covers gray, anesthetic and hollow branches', () => {
    const s=state('swarm','construct'), bud=persistentCards.filter(c=>c.id==='aberrant-bud')
    expect(project('gray-matter-spinal-solution',s).activityRange).toEqual({minimum:2410,maximum:2710})
    expect(project('aberrant-anesthetic-tincture',s,bud).activityRange).toEqual({minimum:2700,maximum:3400})
    expect(project('hollow-spinal-solution',s,bud).activityRange).toEqual({minimum:2410,maximum:3110})
  })
  it('quick boost cannot choose a stronger monster; compound preserves boss', () => {
    const s=state('swarm','construct');s.monsters[0].quantity=5
    expect(rankCards(s,[card('quick-cardiotonic')],[])[0].activityRange).toEqual({minimum:7674,maximum:7674})
    const boss=state('awakened');boss.monsters[0].rarity='boss'
    expect(project('compound-reviving-pill',boss).state.monsters[0]).toMatchObject({race:'aberrant',rarity:'boss',quantity:21,unitActivity:111})
  })
  it('range preview does not expose a button to apply a simulated outcome', () => {
    const r=project('cleansing-ointment',state('construct','swarm'))
    const html=renderToStaticMarkup(<CandidateCardView slotIndex={0} card={r.card} cards={candidateCards}
      result={r} recommended pending={false} disabled={false} onCardChange={()=>{}} onApply={()=>{}} />)
    expect(html).toContain('预计总活性范围');expect(html).toContain('disabled=""')
    expect(html).toContain('游戏使用后按 F8 同步')
  })
  it('special modeled cards stay outside the ordinary redraw pool', () => {
    const special=candidateCards.filter(c=>c.excludeFromRedraw&&!c.evaluationUnavailable)
    expect(special.length).toBeGreaterThan(0)
    expect(estimateRedraw(state('swarm'),special,[],3,123).expectedBest).toBe(123)
  })
})
