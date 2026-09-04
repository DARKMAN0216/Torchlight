import { describe, expect, it } from 'vitest'
import { candidateCards, initialCandidateIds, initialState } from '../data/sampleLibrary'
import type { RecognitionSnapshot } from './contracts'
import { candidateNameSimilarity, mergeRecognitionSnapshot } from './merge'

const recognized = <T>(value: T, confidence = 1) => ({ value, confidence })

describe('recognition merge', () => {
  it('tolerates one OCR character error when matching a card name', () => {
    expect(candidateNameSimilarity('生骨药份', '生骨药粉')).toBe(0.75)
  })

  it('updates high-confidence state and potion candidates while preserving rarity', () => {
    const snapshot: RecognitionSnapshot = {
      capturedAt: '2026-09-04T00:00:00Z',
      phase: recognized('potionSelection'),
      round: recognized(10),
      displayedFinalActivity: recognized(463722),
      candidateCardIds: [],
      candidateCardNames: [
        recognized('生骨药粉'),
        recognized('软脑膜溶液'),
        recognized('脊髓溶液-觉醒者'),
      ],
      monsterSlots: initialState.monsters.map((monster, index) => index === 0 ? {
        slotId: monster.id,
        occupied: recognized(true),
        raceId: recognized('aberrant'),
        quantity: recognized(854),
        unitActivity: recognized(543),
        displayedTotalActivity: recognized(463722),
      } : {
        slotId: monster.id,
        occupied: recognized(false),
      }),
    }

    const result = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      snapshot,
      candidateCards,
    )

    expect(result.state.round).toBe(10)
    expect(result.state.monsters[0]).toMatchObject({
      race: 'aberrant',
      rarity: initialState.monsters[0].rarity,
      quantity: 854,
      unitActivity: 543,
    })
    expect(result.offerCount).toBe(3)
    expect(result.candidateIds.slice(0, 3)).toEqual([
      'birth-bone-powder',
      'soft-meningeal-solution',
      'spinal-solution-awakened',
    ])
    expect(result.matchedCandidateCount).toBe(3)
  })

  it('skips cards during every surgery phase while retaining the recognized board', () => {
    const snapshot: RecognitionSnapshot = {
      capturedAt: '2026-09-04T00:00:00Z',
      phase: recognized('surgeryPlanSelection'),
      candidateCardIds: [],
      candidateCardNames: [recognized('颅骨钻孔术')],
    }
    const result = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      snapshot,
      candidateCards,
    )

    expect(result.candidateIds).toEqual(initialCandidateIds)
    expect(result.warnings.join(' ')).toContain('已跳过手术卡')

    const rewardResult = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      { ...snapshot, phase: recognized('surgeryRewardSelection') },
      candidateCards,
    )
    expect(rewardResult.candidateIds).toEqual(initialCandidateIds)
    expect(rewardResult.warnings.join(' ')).toContain('已跳过手术卡')
  })

  it('rejects monster changes when OCR arithmetic contradicts the displayed final', () => {
    const snapshot: RecognitionSnapshot = {
      capturedAt: '2026-09-04T00:00:00Z',
      phase: recognized('potionSelection'),
      displayedFinalActivity: recognized(999),
      candidateCardIds: [],
      monsterSlots: [{
        slotId: 'slot-1',
        occupied: recognized(true),
        raceId: recognized('aberrant'),
        quantity: recognized(854),
        unitActivity: recognized(543),
        displayedTotalActivity: recognized(463722),
      }],
    }
    const result = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      snapshot,
      candidateCards,
    )

    expect(result.state.monsters).toEqual(initialState.monsters)
    expect(result.warnings.join(' ')).toContain('界面最终活性 999 不一致')
  })
})
