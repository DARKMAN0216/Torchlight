import { describe, expect, it } from 'vitest'
import type { RecognizedMonsterSlot } from './contracts'
import {
  expandedPotionSelection1920,
  potionSelection1920,
  surgeryPreparation1920,
  surgeryRewardSelection1920,
  toPixelRegion,
} from './layout'
import { validateRecognitionConsistency } from './validation'

const recognized = <T>(value: T) => ({ value, confidence: 1 })

describe('screenshot recognition calibration', () => {
  it('defines six ordered monster slots and three surgery-tool cards', () => {
    expect(surgeryPreparation1920.monsterSlots).toHaveLength(6)
    expect(surgeryPreparation1920.candidateCards).toHaveLength(3)
    expect(surgeryPreparation1920.monsterSlots.map((slot) => slot.summary.x))
      .toEqual([...surgeryPreparation1920.monsterSlots]
        .map((slot) => slot.summary.x)
        .sort((left, right) => left - right))
  })

  it('reuses the anchored geometry for the potion-selection phase', () => {
    expect(potionSelection1920.phase).toBe('potionSelection')
    expect(potionSelection1920.monsterSlots).toEqual(surgeryPreparation1920.monsterSlots)
    expect(potionSelection1920.candidateCards).toEqual(surgeryPreparation1920.candidateCards)
  })

  it('distinguishes a threshold reward surgery-tool selection from opening preparation', () => {
    expect(surgeryRewardSelection1920.phase).toBe('surgeryRewardSelection')
    expect(surgeryRewardSelection1920.monsterSlots).toEqual(surgeryPreparation1920.monsterSlots)
    expect(surgeryRewardSelection1920.candidateCards).toEqual(surgeryPreparation1920.candidateCards)
  })

  it('defines five ordered card regions for a large potion box expansion', () => {
    expect(expandedPotionSelection1920.phase).toBe('expandedPotionSelection')
    expect(expandedPotionSelection1920.candidateCards).toHaveLength(5)
    expect(expandedPotionSelection1920.candidateCards.map((card) => card.x))
      .toEqual([...expandedPotionSelection1920.candidateCards]
        .map((card) => card.x)
        .sort((left, right) => left - right))
  })

  it('scales normalized regions back to the reference resolution', () => {
    expect(toPixelRegion(surgeryPreparation1920.roundCounter, 1920, 1080)).toEqual({
      x: 79,
      y: 376,
      width: 131,
      height: 70,
    })
    expect(toPixelRegion(surgeryPreparation1920.candidateCards[2], 1920, 1080)).toEqual({
      x: 1112,
      y: 689,
      width: 228,
      height: 288,
    })
  })

  it('scales the same anchors to the 2560 × 1440 gameplay sample', () => {
    expect(toPixelRegion(potionSelection1920.roundCounter, 2560, 1440)).toEqual({
      x: 105,
      y: 501,
      width: 174,
      height: 94,
    })
  })

  it('reproduces the screenshot total from four groups of 15 × 12', () => {
    const slots: RecognizedMonsterSlot[] = Array.from({ length: 6 }, (_, index) => ({
      slotId: `slot-${index + 1}`,
      occupied: recognized(index < 4),
      ...(index < 4 ? {
        quantity: recognized(12),
        unitActivity: recognized(15),
        displayedTotalActivity: recognized(180),
      } : {}),
    }))

    expect(validateRecognitionConsistency(slots, 720)).toEqual({
      calculatedFinalActivity: 720,
      displayedFinalActivity: 720,
      matchesDisplayedTotal: true,
      issues: [],
    })
  })

  it('flags an OCR result that violates the visible arithmetic', () => {
    const slots: RecognizedMonsterSlot[] = [{
      slotId: 'slot-1',
      occupied: recognized(true),
      quantity: recognized(12),
      unitActivity: recognized(15),
      displayedTotalActivity: recognized(188),
    }]

    const result = validateRecognitionConsistency(slots, 188)

    expect(result.matchesDisplayedTotal).toBe(false)
    expect(result.issues).toHaveLength(2)
  })
})
