import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { persistentCards, candidateCards } from '../data/sampleLibrary'
import type { CandidateCard, DecisionMode, GameState, MonsterGroup } from '../types/game'
import { evaluateCard, evaluateRoundEndTransition, rankCards } from './evaluate'
import { rankPersistentChoices } from './persistentChoice'
import { SettlementSummary } from '../components/SettlementSummary'
import { applyOpportunityPolicy } from './opportunity'

const p = (id: string) => persistentCards.find(card => card.id === id)!
const m = (id: string, race: MonsterGroup['race'], quantity = 100, unitActivity = 1): MonsterGroup =>
  ({ id, race, quantity, unitActivity, rarity: 'common' })
const board = (monsters: MonsterGroup[], mode: DecisionMode = 'activity', round = 3): GameState =>
  ({ round, mode, monsters })
const potion = (effects: CandidateCard['effects'], id = 'test'): CandidateCard =>
  ({ id, name: id, description: '', rarity: 1, tags: [], effects })

it.each(['activity', 'preserve', 'strategic'] as const)('values pupa setup in %s, without applying projected quantities', mode => {
  const source = board([m('1', 'swarm'), m('2', 'construct')], mode)
  const original = structuredClone(source)
  const convert = potion([{ type: 'convertRace', target: 'construct', to: 'swarm' }], 'convert')
  const boost = potion([{ type: 'addQuantity', target: 'construct', amount: 10 }], 'boost')
  const ranking = rankCards(source, [boost, convert], p('human-pupa'))
  expect(ranking[0].card.id).toBe('convert')
  expect(ranking[0].settlement).toMatchObject({ beforeBonus: 8, afterBonus: 32, change: 24, projectedActivity: 232 })
  expect(ranking[0].activityAfter).toBe(200)
  expect(ranking[0].state.monsters.map(item => item.quantity)).toEqual([100, 100])
  expect(source).toEqual(original)
})

it('subtracts lost pupa income even when the deleting potion has positive immediate gain', () => {
  const source = board([m('1', 'swarm', 1, 100), m('2', 'construct', 100, 100)])
  const result = evaluateCard(source, potion([
    { type: 'removeRace', target: 'swarm' },
    { type: 'addActivity', target: 'construct', amount: 2 },
  ]), p('human-pupa'))
  expect(result.delta).toBe(100)
  expect(result.settlement).toMatchObject({ beforeBonus: 800, afterBonus: 0, change: -800 })
  expect(result.scoreDelta).toBe(-700)
  expect(applyOpportunityPolicy([result],3).preferRedraw).toBe(false)
  const html = renderToStaticMarkup(<SettlementSummary result={result} />)
  expect(html).toContain('药剂即时变化：+100')
  expect(html).toContain('常驻结算增减：-800')
  expect(html).toContain('negative')
})

it('detects lost magic threshold and excludes zero-quantity slots from pupa count', () => {
  const source = board([m('1', 'construct', 100, 100), m('2', 'swarm'), m('3', 'awakened')]
    .map(item => ({ ...item, rarity: 'magic' as const })))
  const result = evaluateCard(source, potion([{ type: 'removeRace', target: 'awakened' }]), p('leather-restraint'))
  expect(result.settlement?.change).toBe(-10000)
  expect(evaluateRoundEndTransition(board([m('1','swarm',0), m('2','construct')]), p('human-pupa')).bonus).toBe(0)
})

it('does not mix rarity/slot heuristic points into activity mode', () => {
  const source = board([m('1','construct')], 'activity', 1)
  const result = evaluateCard(source, potion([]), p('plague-madonna'))
  expect(result.score).toBe(100)
  const due = evaluateCard({ ...source, round: 2 }, potion([]), p('plague-madonna'))
  expect(due.score).toBe(100)
  expect(due.settlement?.afterBonus).toBe(0)
})

it('allows negative round-end projections instead of clamping loss to zero', () => {
  const result = evaluateRoundEndTransition(board([m('1','swarm')]), {
    id:'loss', name:'loss', description:'',
    roundEndEffect: { description:'', effects:[{ type:'removeRace', target:'swarm' }] },
  })
  expect(result.activityBonus).toBe(-100)
  expect(result.bonus).toBeLessThan(0)
})

it('projects periodic new permanent on next round and reports incremental income only', () => {
  const source = board([m('1','construct',300)], 'activity', 1)
  const ranking = rankPersistentChoices(source, [p('plague-madonna')], [p('dirty-bone-scraper')])
  expect(ranking[0].modelUnavailable).toContain('变异样本')
  expect(rankPersistentChoices({ ...source, round:2 }, [p('plague-madonna')], [p('dirty-bone-scraper')])[0].nextRoundEndBonus).toBe(0)
  expect(rankPersistentChoices(source, [p('dirty-bone-scraper')], [p('dirty-bone-scraper')])[0].scoreDelta).toBe(0)
  expect(source.round).toBe(1)
})

it('round-end fusion includes the existing removal trigger rather than only the fusion card', () => {
  const source = board([m('slot-1','construct',2,100), m('slot-2','swarm',2,50)]
    .map(item => ({ ...item, rarity:'magic' as const })))
  const alone = evaluateRoundEndTransition(source, p('molting-cortex'))
  const combined = evaluateRoundEndTransition(source, [p('molting-cortex'), p('contracted-claw')])
  expect(combined.activityBonus! - alone.activityBonus!).toBe(150 * 150)
})

it('enumerates all removal-trigger cards and avoids first-card-only results', () => {
  const source = board([m('slot-1','construct'),m('slot-2','construct'),m('slot-3','swarm')])
  const card = candidateCards.find(item => item.id === 'potent-exorcising-powder')!
  const loadout = [p('contracted-claw'),p('adhesive-metatarsal')]
  const result = rankCards(source,[card],loadout)[0]
  expect(result.recommendedTargetIds).toEqual(['slot-1'])
  expect(result.activityAfter).toBe(684)
  expect(result.warnings.some(item => item.includes('随机目标'))).toBe(false)
  expect(rankCards(source,[card],[...loadout].reverse())[0].score).toBe(result.score)
})

it('does not grant an unverified removal bonus after deleting its race threshold', () => {
  const source = board([m('1','construct'),m('2','construct'),m('3','swarm')])
  const result = evaluateCard(source, potion([{ type:'removeRace',target:'selected' }]),
    p('adhesive-metatarsal'), { selectedMonsterIds:['1'] })
  expect(result.activityAfter).toBe(200)
  expect(result.warnings.join()).toContain('条件在事件处理时判定')
})

it('resolves pupa/scraper in the configured order at the 275 threshold', () => {
  const source = board([m('1','swarm',270,10)])
  const saved = structuredClone(source)
  const loadout = [p('human-pupa'), p('dirty-bone-scraper')]
  const result = evaluateRoundEndTransition(source,loadout)
  expect(result.activityBonus).toBe(5640)
  expect(result.analysis.join()).toContain('列表顺序')
  expect(evaluateRoundEndTransition(source,[...loadout].reverse()).activityBonus).toBe(80)
  expect(source).toEqual(saved)
})

it('includes cross-product income instead of adding independent pupa and scraper bonuses', () => {
  const source = board([m('1','swarm',280,1),m('2','swarm',280,2),m('3','construct',280,3)])
  const result = evaluateRoundEndTransition(source,[p('human-pupa'),p('dirty-bone-scraper')])
  expect(result.activityBonus).toBe(17488)
  expect(result.analysis.join()).toContain('17488–17520')
})
