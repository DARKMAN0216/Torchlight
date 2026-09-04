import { describe, expect, it } from 'vitest'
import { evaluateCard, totalActivity } from '../engine/evaluate'
import { candidateCards, persistentCards } from './sampleLibrary'
import {
  observedPersistentOffers,
  observedPersistentSelections,
  observedPotionOffers,
  observedRun,
  observedSurgeryPlanOffers,
} from './observedRun'

describe('observed gameplay run', () => {
  it('keeps every screenshot total arithmetically consistent', () => {
    for (const step of observedRun) {
      expect(totalActivity(step.after), step.id).toBe(step.displayedFinalActivity)
    }
  })

  it('replays every confirmed decision into the next screenshot state', () => {
    for (const step of observedRun) {
      const card = candidateCards.find((item) => item.id === step.chosenCardId)!
      const persistent = persistentCards.filter(
        (item) => step.persistentCardIds.includes(item.id),
      )
      const result = evaluateCard(step.before, card, persistent, step.context)

      if (!step.roundEndPersistentCardId) {
        expect(result.state.monsters, step.id).toEqual(step.after.monsters)
        expect(result.activityAfter, step.id).toBe(step.displayedFinalActivity)
        continue
      }

      expect(result.state.monsters, `${step.id}: potion`).toEqual(step.afterPotion?.monsters)
      const roundEndPersistent = persistentCards.find(
        (item) => item.id === step.roundEndPersistentCardId,
      )!
      const roundEndCard = {
        id: `round-end:${roundEndPersistent.id}`,
        name: `${roundEndPersistent.name}·回合结束`,
        rarity: 3 as const,
        description: roundEndPersistent.roundEndEffect!.description,
        tags: ['常驻卡', '回合结束'],
        effects: roundEndPersistent.roundEndEffect!.effects,
        targeting: roundEndPersistent.roundEndEffect!.targeting,
      }
      const roundEndResult = evaluateCard(
        result.state,
        roundEndCard,
        persistent,
        step.roundEndContext,
      )

      expect(
        { ...roundEndResult.state, round: step.before.round + 1 },
        `${step.id}: round end`,
      ).toEqual(step.after)
      expect(totalActivity(roundEndResult.state), step.id).toBe(step.displayedFinalActivity)
    }
  })

  it('keeps the round and board unchanged when the large potion box expands', () => {
    const expansion = observedRun.find((step) => step.chosenCardId === 'large-potion-box')!

    expect(expansion.before.round).toBe(4)
    expect(expansion.after.round).toBe(4)
    expect(expansion.after).toEqual(expansion.before)
    expect(expansion.afterPhase).toBe('expandedPotionSelection')
  })

  it('records surgery rewards as appended persistent cards before the next round', () => {
    const selection = observedPersistentSelections[0]
    const secondSelection = observedPersistentSelections[1]

    expect(selection.roundBefore).toBe(3)
    expect(selection.roundAfter).toBe(4)
    expect(selection.afterPersistentCardIds).toEqual(['contracted-claw', 'writhing-spinal'])
    expect(totalActivity(selection.state)).toBe(16650)
    expect(secondSelection.roundBefore).toBe(4)
    expect(secondSelection.roundAfter).toBe(5)
    expect(secondSelection.afterPersistentCardIds).toEqual([
      'contracted-claw',
      'writhing-spinal',
      'dirty-bone-scraper',
    ])
    expect(totalActivity(secondSelection.state)).toBe(42732)
  })

  it('records the second surgery offer after brain fog hits the awakened group', () => {
    const offer = observedPersistentOffers[0]

    expect(offer.round).toBe(4)
    expect(offer.persistentCardIds).toEqual(['contracted-claw', 'writhing-spinal'])
    expect(offer.offeredPersistentCardIds).toEqual([
      'leather-restraint',
      'dirty-bone-scraper',
      'clustered-insect-eggs',
    ])
    expect(totalActivity(offer.state)).toBe(42732)
    expect(offer.state.monsters[2]).toMatchObject({ rarity: 'rare', unitActivity: 176 })
  })

  it('records round five without retroactively triggering the newly selected scraper', () => {
    const offer = observedPotionOffers[0]

    expect(offer.round).toBe(5)
    expect(offer.persistentCardIds.at(-1)).toBe('dirty-bone-scraper')
    expect(offer.offeredCardNames).toEqual(['消化酶溶液', '灰质脊髓溶液', '麻药酊剂-异魔'])
    expect(totalActivity(offer.state)).toBe(42732)
    expect(offer.state.monsters[1]).toMatchObject({ quantity: 316, unitActivity: 45 })
  })

  it('records the confirmed round-six board and its three offered potions', () => {
    const offer = observedPotionOffers[1]
    const step = observedRun.find((item) => item.chosenCardId === 'digestive-enzyme-solution')!

    expect(offer.round).toBe(6)
    expect(offer.offeredCardNames).toEqual(['脊髓溶液-异魔', '活殖药粉', '益生霉溶液'])
    expect(totalActivity(offer.state)).toBe(68328)
    expect(offer.state.monsters[1]).toMatchObject({
      race: 'construct',
      rarity: 'common',
      quantity: 316,
      unitActivity: 126,
    })
    expect(offer.state.monsters[2]).toMatchObject({
      race: 'awakened',
      rarity: 'rare',
      quantity: 162,
      unitActivity: 176,
    })
    expect(totalActivity(step.afterPotion!)).toBe(62008)
  })

  it('records that active cultivation only hit the rare awakened group in round six', () => {
    const offer = observedPotionOffers[2]
    const step = observedRun.find((item) => item.chosenCardId === 'active-cultivation-powder')!

    expect(offer.round).toBe(7)
    expect(offer.offeredCardNames).toEqual(['蜕生皮溶液', '细肢药粉-蛊虫', '稀有药剂箱（小）'])
    expect(step.context.selectedMonsterIds).toEqual(['slot-3'])
    expect(step.afterPotion?.monsters[1]).toMatchObject({ quantity: 316, unitActivity: 126 })
    expect(step.afterPotion?.monsters[2]).toMatchObject({ quantity: 194, unitActivity: 176 })
    expect(totalActivity(step.afterPotion!)).toBe(73960)
    expect(step.after.monsters[1]).toMatchObject({ quantity: 316, unitActivity: 146 })
    expect(totalActivity(step.after)).toBe(80280)
  })

  it('replays the confirmed fusion, add mutation, removal trigger, and scraper chain', () => {
    const offer = observedPotionOffers[3]
    const step = observedRun.find((item) => item.chosenCardId === 'molting-skin-solution')!

    expect(offer.round).toBe(8)
    expect(offer.offeredCardNames).toEqual(['药剂箱（小）', '脊髓溶液-异魔', '消化酶溶液'])
    expect(step.afterPotion?.monsters[0]).toMatchObject({
      race: 'aberrant',
      rarity: 'common',
      quantity: 660,
      unitActivity: 402,
    })
    expect(step.afterPotion?.monsters[1].race).toBeNull()
    expect(totalActivity(step.afterPotion!)).toBe(265320)
    expect(step.after.monsters[0]).toMatchObject({ quantity: 660, unitActivity: 422 })
    expect(totalActivity(step.after)).toBe(278520)
  })

  it('replays digestive enzyme on the leftmost group without a removal loss', () => {
    const offer = observedPotionOffers[4]
    const step = observedRun.find((item) => item.id === 'round-8-digestive-enzyme-and-dirty-bone-scraper')!

    expect(offer.round).toBe(9)
    expect(offer.offeredCardNames).toEqual(['强效祛异药粉', '细肢药粉-蛊虫', '细肢药粉-骨卫兵'])
    expect(step.afterPotion?.monsters[0]).toMatchObject({ quantity: 660, unitActivity: 483 })
    expect(totalActivity(step.afterPotion!)).toBe(318780)
    expect(totalActivity(step.after)).toBe(331980)
  })

  it('allows potent exorcising powder to resolve with zero removals when no other race exists', () => {
    const offer = observedPotionOffers[5]
    const step = observedRun.find((item) => item.id === 'round-9-potent-exorcising-powder-without-removals')!

    expect(offer.round).toBe(10)
    expect(offer.offeredCardNames).toEqual(['生骨药粉', '孪生激素-蛊虫', '混合活蛭溶液'])
    expect(step.context.observedRemovedMonsterIds).toBeUndefined()
    expect(step.afterPotion?.monsters[0]).toMatchObject({ quantity: 814, unitActivity: 503 })
    expect(totalActivity(step.afterPotion!)).toBe(409442)
    expect(step.after.monsters[0]).toMatchObject({ quantity: 814, unitActivity: 523 })
    expect(totalActivity(step.after)).toBe(425722)
  })

  it('maps all three cards currently shown in the round-ten offer', () => {
    const offer = observedPotionOffers.at(-1)!
    const mapped = offer.offeredCardNames.map((name) =>
      candidateCards.find((card) => card.name === name),
    )

    expect(mapped.every(Boolean)).toBe(true)
    expect(mapped.map((card) => card!.modelCoverage ?? 'confirmed')).toEqual([
      'confirmed',
      'partial',
      'unresolved',
    ])
  })

  it('replays birth bone powder into the player-owned round-eleven surgery plan phase', () => {
    const step = observedRun.at(-1)!
    const offer = observedSurgeryPlanOffers[0]

    expect(step.chosenCardId).toBe('birth-bone-powder')
    expect(step.afterPotion?.monsters[0]).toMatchObject({ quantity: 854, unitActivity: 523 })
    expect(step.after.monsters[0]).toMatchObject({ quantity: 854, unitActivity: 543 })
    expect(step.afterPhase).toBe('surgeryPlanSelection')
    expect(totalActivity(step.after)).toBe(463722)
    expect(offer.state).toEqual(step.after)
    expect(offer.decisionAuthority).toBe('player')
    expect(offer.plans).toEqual([
      { name: '颅骨钻孔术', risk: 'high' },
      { name: '表皮移植实验', risk: 'low' },
      { name: '全身针灸疗法', risk: 'high' },
    ])
  })
})
