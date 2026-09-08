import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { persistentCards } from '../data/sampleLibrary'
import { evaluateCard, evaluateRoundEndTransition } from './evaluate'
import { confirmedRoundEnd, previewPassives } from './sharedPassives'
import { parsePersistentModel } from './persistentModelData'
import { RecommendationPanel } from '../components/RecommendationPanel'
import { SettlementSummary } from '../components/SettlementSummary'
import { CandidateCardView } from '../components/CandidateCardView'
import { PersistentRecommendation } from '../components/PersistentRecommendation'
import { rankPersistentChoices } from './persistentChoice'
import { applyOpportunityPolicy } from './opportunity'
import type { CandidateCard, GameState, MonsterGroup } from '../types/game'

const p = (id:string)=>persistentCards.find(p=>p.id===id)!
const group = (id:string,race:MonsterGroup['race']='swarm',quantity=10,unitActivity=10):MonsterGroup=>
  ({id,race,rarity:'common',quantity,unitActivity})
const board = (groups:MonsterGroup[],round=3):GameState=>({round,mode:'activity',monsters:[...groups,
  ...Array.from({length:6-groups.length},(_,i)=>group(`slot-${groups.length+i+1}`,null,0,0))]})
const card = (effects:CandidateCard['effects']):CandidateCard=>({id:'test',name:'测试药剂',rarity:1,description:'',tags:[],effects})

it('desktop uses all 24 real stable definitions, excluding demos from the count',()=>{
  expect(persistentCards.filter(p=>p.sharedRules)).toHaveLength(24)
})
it('does not label a candidate as recommended or allow application with missing model data',()=>{
  const potion=card([])
  const result=evaluateCard(board([group('slot-1')],2),potion,p('plague-madonna'))
  const html=renderToStaticMarkup(<CandidateCardView slotIndex={0} card={potion} cards={[potion]} result={result}
    recommended pending={false} disabled={false} onCardChange={()=>{}} onApply={()=>{}} />)
  expect(html).toContain('完整收益尚不可计算')
  expect(html).not.toContain('recommend-flag')
  expect(html).not.toContain('建议目标')
  expect(html).toContain('disabled=""')
})
it('desktop handles both success-add and full-board failure without fake growth',()=>{
  const source=board([group('slot-1'),group('slot-2')])
  const result=evaluateCard(source,card([{type:'addGroup',race:'construct'}]),[p('hatching-sac')])
  expect(result.state.monsters.slice(0,3).map(m=>m.quantity)).toEqual([55,55,57])
  const full=board(Array.from({length:6},(_,i)=>group(`slot-${i+1}`)))
  const overflow=evaluateCard(full,card([{type:'addGroup',race:'swarm',count:2}]),[p('hatching-sac'),p('two-inch-skull-nail')])
  expect(overflow.settlement?.afterBonus).toBe(2250)
  expect(overflow.requiresOutcomeSync).toBe(true)
  expect(overflow.state.monsters.map(m=>m.quantity)).toEqual([10,10,10,10,10,10])
})
it('desktop applies deterministic removal growth and mutation threshold crossing',()=>{
  const state=board([group('slot-1','construct',20,10),group('slot-2')])
  const removed=evaluateCard(state,card([{type:'removeRace',target:'swarm'}]),[p('eyelid-dilator')])
  expect(removed.state.monsters[0]).toMatchObject({quantity:40,unitActivity:30})
  const before=board([group('slot-1','aberrant'),group('slot-2')])
  const changed=evaluateCard(before,card([{type:'convertRace',target:'swarm',to:'aberrant'}]),p('mottled-liver'))
  expect(changed.state.monsters.slice(0,2).map(m=>m.unitActivity)).toEqual([30,30])
})
it('desktop settles all deterministic passives once in sequence',()=>{
  const source=board([group('slot-1','construct',300,251)])
  const result=confirmedRoundEnd(source,[p('iron-bone-saw'),p('canine-rasp'),p('dirty-bone-scraper')])
  expect(result.state?.monsters[0]).toMatchObject({quantity:345,unitActivity:286})
  expect(source.monsters[0]).toMatchObject({quantity:300,unitActivity:251})
})
it('supports beast transfer and six-group beak in the desktop evaluator',()=>{
  const state=board([group('slot-1','construct'),group('slot-2','construct'),group('slot-3','swarm',5,4)])
  expect(evaluateRoundEndTransition(state,p('beast-tendon-cord')).activityBonus).toBe(90)
  expect(evaluateRoundEndTransition(board(Array.from({length:6},(_,i)=>group(`slot-${i+1}`))),p('second-born-beak')).activityBonus).toBe(200)
})
it('never treats missing generation/upgrade data as a complete zero-gain recommendation',()=>{
  const source=board([group('slot-1'),group('slot-2'),group('slot-3')])
  const result=evaluateCard(source,card([]),p('clustered-insect-eggs'))
  expect(result.modelUnavailable).toContain('基础数值')
  expect(applyOpportunityPolicy([result],3).preferRedraw).toBe(false)
  const panel=renderToStaticMarkup(<RecommendationPanel ranking={[result]} onApply={()=>{}} />)
  expect(panel).toContain('暂不能给出完整推荐');expect(panel).not.toContain('应用推荐到局面')
  expect(renderToStaticMarkup(<SettlementSummary result={result}/>)).toContain('常驻结算缺少数据')
  const choices=rankPersistentChoices(source,[p('clustered-insect-eggs')],[])
  expect(renderToStaticMarkup(<PersistentRecommendation offers={[]} ranking={choices}/>)).toContain('结算需要补充数据')
})
it('explicit newborn data enables eggs and fires its add chain',()=>{
  const source=board([group('slot-1'),group('slot-2'),group('slot-3')])
  source.newbornSwarm={rarity:'magic',quantity:7,unitActivity:9}
  const result=confirmedRoundEnd(source,[p('clustered-insect-eggs'),p('hatching-sac')])
  expect(result.state?.monsters[3]).toMatchObject({rarity:'magic',quantity:152,unitActivity:9})
  expect(result.state?.monsters[0].quantity).toBe(55)
})
it('explicit conversion samples enable real stat changes instead of only relabelling rarity',()=>{
  const source=board([group('slot-1')],2)
  source.persistentModel=parsePersistentModel(JSON.stringify({raritySamples:[{
    id:'sample',cardId:'plague-madonna',beforeMonsterId:'before',afterMonsterId:'after',fromRarity:'common',toRarity:'magic',
    beforeQuantity:10,afterQuantity:20,beforeUnitActivity:10,afterUnitActivity:15,
  }]}))
  expect(confirmedRoundEnd(source,p('plague-madonna')).state?.monsters[0]).toMatchObject({rarity:'magic',quantity:20,unitActivity:15})
})
it('retains delay metadata and exposes uncertain outcomes without committing a lucky sample',()=>{
  const source=board([group('slot-1','construct',300)])
  source.persistentAcquiredRounds={'dirty-bone-scraper':3}
  expect(evaluateRoundEndTransition(source,p('dirty-bone-scraper')).activityBonus).toBe(0)
  expect(evaluateRoundEndTransition({...source,round:4},p('dirty-bone-scraper')).activityBonus).toBe(6000)
  const many=board(Array.from({length:6},(_,i)=>group(`slot-${i+1}`,i===5?'construct':'swarm')))
  const preview=previewPassives(many,p('human-pupa'),[{type:'roundEnd',source:'round',round:3}])
  expect(preview.exhaustive).toBe(false);expect(preview.outcomes).toHaveLength(32)
  expect(confirmedRoundEnd(many,p('human-pupa')).state).toBeUndefined()
})
it('strictly validates imported data and never derives base stats from grown monsters',()=>{
  expect(()=>parsePersistentModel('{"monsters":[{"monsterId":"x","race":"swarm","rarity":"common","quantity":0,"unitActivity":15}]}')).toThrow()
  expect(()=>parsePersistentModel('{"pupaRepetitions":"guess"}')).toThrow()
  expect(()=>parsePersistentModel('{"rarityPriors":{"magic":[{"quantity":12,"unitActivity":1.5}]}}')).toThrow()
  const valid={monsters:[{monsterId:'x',race:'swarm',rarity:'rare',quantity:12,unitActivity:15}],pupaRepetitions:'additionalX'}
  expect(parsePersistentModel(JSON.stringify(valid))).toEqual(valid)
})
