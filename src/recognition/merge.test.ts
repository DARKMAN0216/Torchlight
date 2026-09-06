import { describe, expect, it } from 'vitest'
import { candidateCards, initialCandidateIds, initialState, persistentCards } from '../data/sampleLibrary'
import type { RecognitionSnapshot } from './contracts'
import { candidateNameSimilarity, matchPersistentName, mergeRecognitionSnapshot } from './merge'
import { rankPersistentChoices } from '../engine/persistentChoice'

const recognized = <T>(value: T, confidence = 1) => ({ value, confidence })

describe('recognition merge', () => {
  const rarityFixture = (): RecognitionSnapshot => ({
    capturedAt: '2026-09-06T00:00:00Z', candidateCardIds: [],
    displayedFinalActivity: recognized(228),
    monsterSlots: initialState.monsters.map((monster, index) => index < 4 ? {
      slotId: monster.id, occupied: recognized(true),
      raceId: recognized(index < 2 ? 'construct' : 'awakened'),
      rarity: recognized(index < 3 ? 'common' : 'magic'),
      quantity: recognized(index < 3 ? 36 : 24),
      unitActivity: recognized(index < 3 ? 1 : 5),
      displayedTotalActivity: recognized(index < 3 ? 36 : 120),
    } : { slotId: monster.id, occupied: recognized(false) }),
  })

  it('replaces stale rarities including saved boss and removes false pituitary bonus', () => {
    const old = { ...initialState, monsters: initialState.monsters.map((monster) => ({ ...monster, rarity: 'boss' as const })) }
    const result = mergeRecognitionSnapshot(old, initialCandidateIds, 3, rarityFixture(), candidateCards)
    expect(result.state.monsters.slice(0, 4).map((monster) => monster.rarity)).toEqual(['common', 'common', 'common', 'magic'])
    expect(result.state.recognitionReview).toEqual([])
    const pituitary = persistentCards.find((card) => card.name === '肿大脑垂体')!
    const ranking = rankPersistentChoices(result.state, [pituitary], [persistentCards[0]])
    expect(ranking[0].nextRoundEndBonus).toBe(0)
    expect(ranking[0].scoreDelta).toBe(0)
  })

  it('flags missing or low-confidence rarity instead of certifying retained old values', () => {
    const snapshot = rarityFixture()
    snapshot.monsterSlots![0].rarity = undefined
    snapshot.monsterSlots![1].rarity = recognized('boss', 0.4)
    const result = mergeRecognitionSnapshot(initialState, initialCandidateIds, 3, snapshot, candidateCards)
    expect(result.state.recognitionReview).toHaveLength(2)
    expect(result.warnings.join(' ')).toContain('稀有度未可靠识别')
    // A card-only snapshot must not silently clear the unresolved review.
    const cardOnly = mergeRecognitionSnapshot(result.state, initialCandidateIds, 3,
      { capturedAt: '', candidateCardIds: [] }, candidateCards)
    expect(cardOnly.state.recognitionReview).toEqual(result.state.recognitionReview)
  })

  it('clears previous review only after a reliable monster snapshot', () => {
    const old = { ...initialState, recognitionReview: ['slot-1 稀有度待核对'] }
    expect(mergeRecognitionSnapshot(old, initialCandidateIds, 3, rarityFixture(), candidateCards)
      .state.recognitionReview).toEqual([])
  })

  it('restores the missing second slot in the round-seven sample without manual acknowledgement', () => {
    const snapshot = rarityFixture()
    snapshot.round = recognized(7)
    snapshot.displayedFinalActivity = recognized(118200)
    const values = [
      ['aberrant', 'rare', 581, 191], ['awakened', 'common', 36, 32],
      ['awakened', 'rare', 36, 162], ['construct', 'magic', 49, 5],
    ] as const
    values.forEach(([race, rarity, quantity, unitActivity], index) => {
      Object.assign(snapshot.monsterSlots![index], {
        raceId: recognized(race), rarity: recognized(rarity), quantity: recognized(quantity),
        unitActivity: recognized(unitActivity), displayedTotalActivity: recognized(quantity * unitActivity),
      })
    })
    const old = { ...initialState, recognitionReview: ['slot-2 种群未可靠识别'],
      monsters: initialState.monsters.map((monster,index) => index === 1 ? { ...monster, race: null } : monster) }
    const result = mergeRecognitionSnapshot(old, initialCandidateIds, 3, snapshot, candidateCards)
    expect(result.state.recognitionReview).toEqual([])
    expect(result.state.monsters[1]).toMatchObject({race:'awakened',rarity:'common',quantity:36,unitActivity:32})
    expect(result.state.monsters.filter(monster => monster.race)).toHaveLength(4)
  })
  it('tolerates one OCR character error when matching a card name', () => {
    expect(candidateNameSimilarity('生骨药份', '生骨药粉')).toBe(0.75)
  })

  it('maps observed OCR aliases for newly catalogued persistent tools', () => {
    expect(matchPersistentName(recognized('梳造骸骨'), persistentCards).card?.id)
      .toBe('adhesive-metatarsal')
    expect(matchPersistentName(recognized('蔓生肉芽'), persistentCards).card?.id)
      .toBe('aberrant-bud')
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

  it('keeps early surgery rewards as persistent-card choices and skips only post-round-ten plans', () => {
    const snapshot: RecognitionSnapshot = {
      capturedAt: '2026-09-04T00:00:00Z',
      phase: recognized('surgeryPlanSelection'),
      round: recognized(11),
      candidateCardIds: [],
      candidateCardNames: [recognized('颅骨钻孔术')],
    }
    const result = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      snapshot,
      candidateCards,
      persistentCards,
    )

    expect(result.candidateIds).toEqual(initialCandidateIds)
    expect(result.warnings.join(' ')).toContain('已跳过方案卡')

    const rewardResult = mergeRecognitionSnapshot(
      initialState,
      initialCandidateIds,
      5,
      {
        ...snapshot,
        phase: recognized('surgeryRewardSelection'),
        round: recognized(4),
        candidateCardNames: [
          recognized('生皮革拘束带'),
          recognized('脏污刮骨刀'),
          recognized('簇生虫卵'),
        ],
      },
      candidateCards,
      persistentCards,
    )
    expect(rewardResult.candidateIds).toEqual(initialCandidateIds)
    expect(rewardResult.matchedPersistentCount).toBe(3)
    expect(rewardResult.persistentOffers.map((offer) => offer.cardId)).toEqual([
      'leather-restraint',
      'dirty-bone-scraper',
      'clustered-insect-eggs',
    ])
    expect(rewardResult.warnings).toEqual([])
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
