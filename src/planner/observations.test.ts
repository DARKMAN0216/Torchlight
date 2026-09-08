import { describe, expect, it } from 'vitest'
import { board, model, monster, play } from './fixtures.test-support'
import { extractRaritySample, fromRecognitionSnapshot, reconcileObservation, serializeRecords } from './observations'
import { sampleRarityStats } from './empirical'
import { seededRandom } from './random'
import { createPlannerModel, implementedCards, implementedPersistent, modelCoverage } from './catalog'
import { candidateCards } from '../data/sampleLibrary'
import type { RecognitionSnapshot } from '../recognition/contracts'
import type { RarityTransitionSample } from './types'

const value = <T>(v: T) => ({ value: v, confidence: .99 })
function snapshot(): RecognitionSnapshot {
  return {
    capturedAt: '2026-09-07T12:01:00Z', phase: value('surgeryPlanSelection'), round: value(11),
    rerollsRemaining: value(0), displayedFinalActivity: value(120), persistentCardIds: [], candidateCardIds: [],
    monsterSlots: board().slots.map(s => s.monster ? {
      slotId: s.slotId, occupied: value(true), name: value('测试怪物'), raceId: value('swarm'),
      rarity: value('common'), quantity: value(12), unitActivity: value(10), displayedTotalActivity: value(120),
    } : { slotId: s.slotId, occupied: value(false) }),
  }
}
function input() {
  return { id: 'decision-1', runId: 'run-1', capturedBefore: '2026-09-07T12:00:00Z',
    before: board(), predicted: board({ round: 11 }), action: play(), snapshot: snapshot(), modelVersion: 'v1' }
}
describe('observation calibration', () => {
  it('overwrites predictions with complete verified actual slots and records errors', () => {
    const data = input(), original = structuredClone(data)
    const result = reconcileObservation(data)
    expect(data).toEqual(original)
    expect(result.state.slots[0].monster!.quantity).toBe(12)
    expect(result.record).toMatchObject({ accepted: true, trainingEligible: true, activityError: 20, changedSlots: ['slot-1'] })
  })
  it('rejects low confidence without overwriting the real prior board or training', () => {
    const data = input(); data.snapshot.monsterSlots![0].quantity!.confidence = .5
    const result = reconcileObservation(data)
    expect(result.record.accepted).toBe(false); expect(result.record.trainingEligible).toBe(false)
    expect(result.state.slots[0].monster!.quantity).toBe(10)
    expect(result.state.recognitionReview.length).toBeGreaterThan(0)
  })
  it.each(['missingSlot', 'duplicateSlot', 'totalMismatch', 'roundMismatch', 'newPassive', 'staleFrame'] as const)(
    'rejects %s rather than filling unknown fields from prediction', kind => {
      const data = input()
      if (kind === 'missingSlot') data.snapshot.monsterSlots!.pop()
      if (kind === 'duplicateSlot') data.snapshot.monsterSlots![1].slotId = 'slot-1'
      if (kind === 'totalMismatch') data.snapshot.displayedFinalActivity!.value = 999
      if (kind === 'roundMismatch') data.snapshot.round!.value = 10
      if (kind === 'newPassive') data.snapshot.persistentCardIds = [value('dirty-bone-scraper')]
      if (kind === 'staleFrame') data.snapshot.capturedAt = data.capturedBefore
      expect(reconcileObservation(data).record.accepted).toBe(false)
    })
  it('treats invalid OCR integers as rejected observations', () => {
    const data = input()
    data.snapshot.monsterSlots![0].quantity!.value = 1.2
    data.snapshot.monsterSlots![0].displayedTotalActivity!.value = 12
    data.snapshot.displayedFinalActivity!.value = 12
    expect(reconcileObservation(data).record.accepted).toBe(false)
  })
  it('cannot reduce the training confidence threshold', () => {
    expect(() => fromRecognitionSnapshot(board({ round: 11 }), snapshot(), .5)).toThrow('门槛')
  })
  it('does not learn rarity stats from a whole-round outcome without isolated reviewed evidence', () => {
    const record = reconcileObservation(input()).record
    expect(() => extractRaritySample(record, { isolatedMutation: false, reviewed: true, slotId: 'slot-1' })).toThrow('独立变异')
  })
  it('exports immutable JSONL and rejects duplicate IDs', () => {
    const record = reconcileObservation(input()).record
    expect(JSON.parse(serializeRecords([record]).trim())).toEqual(JSON.parse(JSON.stringify(record)))
    expect(() => serializeRecords([record, record])).toThrow('重复')
  })
  it('does not label unknown monster identity as training-ready', () => {
    const data = input(); data.before.slots[0].monster!.monsterId = 'unresolved:swarm:common'
    const result = reconcileObservation(data)
    expect(result.record.accepted).toBe(true)
    expect(result.record.trainingEligible).toBe(false)
  })
})

describe('rarity empirical model', () => {
  const sample: RarityTransitionSample = {
    id: 'sample-1', cardId: 'card', beforeMonsterId: 'test-monster', afterMonsterId: 'magic-monster',
    fromRarity: 'common', toRarity: 'magic', beforeQuantity: 10, afterQuantity: 15,
    beforeUnitActivity: 10, afterUnitActivity: 30,
  }
  it('prefers exact card/monster samples and transfers integer deltas', () => {
    const m = model(); m.raritySamples = [sample, { ...sample, id: 'other', cardId: 'other', afterQuantity: 500 }]
    const stats = sampleRarityStats(monster({ quantity: 50 }), 'magic', 'card', 'magic-monster', m, seededRandom(2))
    expect(stats).toMatchObject({ quantity: 55, unitActivity: 30 })
    expect(stats.warning).toContain('层级1')
  })
  it('falls back from card-and-rarity to generic rarity samples', () => {
    const m = model(); m.raritySamples = [sample]
    expect(sampleRarityStats(monster(), 'magic', 'card', undefined, m, seededRandom(1)).warning).toContain('层级2')
    expect(sampleRarityStats(monster(), 'magic', 'other', undefined, m, seededRandom(1)).warning).toContain('层级3')
  })
  it('uses an explicit empirical prior with a low-confidence warning', () => {
    const m = model(); m.rarityPriors.magic = [{ quantity: 7, unitActivity: 15 }]
    const result = sampleRarityStats(monster(), 'magic', 'card', undefined, m, seededRandom(1))
    expect(result).toMatchObject({ quantity: 7, unitActivity: 15 })
    expect(result.warning).toContain('低置信度')
  })
  it('blocks missing data and negative transferred stats', () => {
    const m = model()
    expect(() => sampleRarityStats(monster(), 'magic', 'card', undefined, m, seededRandom(1))).toThrow('缺少')
    m.raritySamples = [{ ...sample, beforeQuantity: 200 }]
    expect(() => sampleRarityStats(monster(), 'magic', 'card', undefined, m, seededRandom(1))).toThrow('非正数')
  })
})

describe('real catalog migration coverage', () => {
  it('keeps existing stable IDs and marks every unmigrated candidate explicitly', () => {
    const m = createPlannerModel()
    for (const definition of implementedCards)
      expect(candidateCards.find(c => c.id === definition.id)?.name).toBe(definition.name)
    expect(new Set(m.cards.map(c => c.id)).size).toBe(m.cards.length)
    expect(modelCoverage(m).cards.filter(c => c.status === 'implemented')).toHaveLength(33)
    expect(modelCoverage(m).persistent.filter(c => c.status === 'implemented')).toHaveLength(implementedPersistent.length)
    expect(m.monsters).toEqual([]) // old 15×12 defaults are not silently reused.
    expect(m.persistent.find(p => p.id === 'human-pupa')?.triggers[0].effects).toEqual([{type:'pupaGrowth'}])
    expect(m.cards.find(c => c.id === 'large-potion-box')?.unsupportedReason).toBeTruthy()
  })
})
