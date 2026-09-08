import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { candidateCards, persistentCards } from '../data/sampleLibrary'
import { rankCards } from './evaluate'
import { replacementExploration, startupNeed } from './startup'
import { applyOpportunityPolicy } from './opportunity'
import { StartupAdvice } from '../components/StartupAdvice'
import type { CandidateCard, GameState } from '../types/game'

const card = (id: string) => candidateCards.find(c => c.id === id)!
const pupa = persistentCards.filter(c => c.id === 'human-pupa')
const gray = card('gray-matter-spinal-solution'), mutagen = card('mutagen-powder')
const xeno = candidateCards.find(c => c.name === '异种激素')!
const board = (): GameState => ({round:1, mode:'strategic', monsters:Array.from({length:6},(_,i)=>({
  id:`slot-${i+1}`, race:i<3?'awakened':null, rarity:i===2?'rare':i<2?'magic':'common',
  quantity:i===2?12:i<2?24:0, unitActivity:i===2?15:i<2?5:0,
}))})
const boost: CandidateCard = {id:'boost',name:'仅即时加成',rarity:1,description:'',tags:[],effects:[{type:'addActivity',target:'all',amount:100,allMatches:true}]}

it('reproduces screenshot: mutagen is not zero, picks two targets and reveals the dormant pupa route', () => {
  const source=board(), original=structuredClone(source)
  const ranking=rankCards(source,[gray,mutagen,xeno],pupa)
  expect(ranking.filter(r=>!r.modelUnavailable).map(r=>r.card.id)).toEqual([mutagen.id,gray.id])
  expect(ranking[0].delta).toBe(1040)
  expect(ranking[0].recommendedTargetIds).toEqual(['slot-1','slot-3'])
  expect(ranking[0].startup).toMatchObject({minimumGroups:0,maximumGroups:2,safeForPriority:true})
  expect(ranking[0].activityRange).toEqual({minimum:1460,maximum:1460})
  expect(ranking[0].trace.join(' ')).toContain('16个分支')
  expect(ranking[0].card.requiresScreenSync).toBe(true)
  expect(source).toEqual(original)
  expect(ranking.find(r=>r.card.id===xeno.id)?.modelUnavailable).toContain('rarityBases')
})

it('gray can acquire swarm, but its second aberrant conversion prevents a guaranteed startup', () => {
  const result=rankCards(board(),[gray],pupa)[0]
  expect(result.startup).toMatchObject({minimumGroups:0,maximumGroups:1})
  expect(result.recommendedTargetIds).toBeUndefined()
})

it('separates strategy preference from activity score and disables numeric automatic redraw decisions', () => {
  const s=board()
  const strategic=rankCards(s,[boost,mutagen],pupa)
  expect(strategic[0].card.id).toBe(mutagen.id)
  expect(strategic[0].score).toBeLessThan(strategic[1].score)
  expect(rankCards({...s,mode:'activity'},[boost,mutagen],pupa)[0].card.id).toBe(boost.id)
  expect(applyOpportunityPolicy(strategic,3)).toMatchObject({preferPotionBox:false,preferRedraw:false})
})

it('prefers a guaranteed startup over more merely possible groups without inventing odds', () => {
  const convert:CandidateCard={...boost,id:'guaranteed',effects:[{type:'convertRace',target:'awakened',to:'swarm'}]}
  const ranking=rankCards(board(),[mutagen,convert],pupa)
  expect(ranking[0].card.id).toBe('guaranteed')
  expect(ranking[0].startup?.minimumGroups).toBe(1)
})

it('does not globally force this strategy without pupa, with existing swarm, on last potion round or uncertain board', () => {
  const s=board()
  expect(startupNeed(s,[])).toBeNull()
  s.monsters[1].race='swarm'
  expect(startupNeed(s,pupa)).toBeNull()
  expect(startupNeed({...board(),round:10},pupa)).toBeNull()
  expect(startupNeed({...board(),recognitionReview:['uncertain']},pupa)).toBeNull()
  expect(rankCards(board(),[boost,mutagen],[])[0].card.id).toBe(boost.id)
})

it('empty/zero-quantity monsters are not targets or an active pupa anchor', () => {
  const s=board();s.monsters[3]={id:'slot-4',race:'swarm',rarity:'boss',quantity:0,unitActivity:999}
  expect(startupNeed(s,pupa)?.race).toBe('swarm')
  expect(rankCards(s,[mutagen],pupa)[0].recommendedTargetIds).not.toContain('slot-4')
})

it('does not promote a route that sacrifices more activity than it produces', () => {
  const risk:CandidateCard={...boost,id:'risk',effects:[{type:'removeRace',target:'awakened'},
    {type:'convertRace',target:'awakened',to:'swarm'}]}
  const ranking=rankCards(board(),[risk,boost],pupa)
  expect(ranking[0].card.id).toBe('boost')
  expect(ranking.find(r=>r.card.id==='risk')?.startup?.safeForPriority).toBe(false)
})

it('replacement remains exploratory: choose smallest removal, capacity-limited opportunities, no made-up new stats', () => {
  expect(xeno.confirmedPotion).toBe(true)
  expect(replacementExploration(board(),xeno,'swarm')).toEqual({ids:['slot-1'],opportunities:4,removedActivity:120,removesAnchor:false})
  const full=board(); for(let i=3;i<6;i++) full.monsters[i]={...full.monsters[0],id:`slot-${i+1}`}
  expect(replacementExploration(full,xeno,'swarm')?.opportunities).toBe(1)
  expect(replacementExploration({...board(),monsters:board().monsters.map(m=>({...m,race:null,quantity:0}))},xeno,'swarm')).toBeNull()
})

it('manual target restriction and boss cap survive random mutation projection', () => {
  const s=board();s.monsters[0].rarity='boss'
  const r=rankCards(s,[mutagen],pupa,{selectedMonsterIds:['slot-1']})[0]
  expect(r.state.monsters[0].rarity).toBe('boss')
  expect(r.raceGroupRange?.swarm?.maximum).toBe(1)
  expect(r.delta).toBe(260)
})

it('an on-add mutation can erase a new swarm: do not claim guaranteed startup from an unprojected add', () => {
  const loadout=[...pupa,...persistentCards.filter(c=>c.id==='writhing-spinal')]
  const r=rankCards(board(),[card('fine-limb-powder-swarm')],loadout)[0]
  expect(r.startup).toMatchObject({minimumGroups:0,maximumGroups:1})
})

it('still exposes unknown exploration when no potion can be numerically ranked', () => {
  const state=board(), ranking=rankCards(state,[xeno],pupa)
  expect(ranking).toHaveLength(1)
  expect(ranking[0].modelUnavailable).toContain('rarityBases')
  const html=renderToStaticMarkup(<StartupAdvice state={state} loadout={pupa} cards={[xeno]} ranking={ranking} compact />)
  expect(html).toContain('探索备选');expect(html).toContain('异种激素')
  expect(html).not.toContain('启动路线首选')
})

it('renders unknown replacement as an option with loss, not a fake zero or certain swarm', () => {
  const state=board(),ranking=rankCards(state,[gray,mutagen,xeno],pupa)
  const html=renderToStaticMarkup(<StartupAdvice state={state} loadout={pupa} cards={[gray,mutagen,xeno]} ranking={ranking}/> )
  expect(html).toContain('启动人蛹标本');expect(html).toContain('探索备选')
  expect(html).toContain('120');expect(html).toContain('净收益未知')
  expect(html).toContain('50%');expect(html).toContain('不假设各种群等概率')
  expect(renderToStaticMarkup(<StartupAdvice state={state} loadout={[]} cards={[gray,mutagen,xeno]} ranking={ranking}/>)).toBe('')
})
