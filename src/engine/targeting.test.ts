import { describe, expect, it } from 'vitest'
import { candidateCards, initialState, persistentCards } from '../data/sampleLibrary'
import type { CardTargeting, GameState } from '../types/game'
import { rankCards } from './evaluate'
import { enumerateTargetSets, targetSetIsValid } from './targeting'

describe('target combination analysis', () => {
  it('enumerates every legal one-or-two target combination', () => {
    const targeting: CardTargeting = {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 2,
      prompt: '',
    }

    expect(enumerateTargetSets(initialState, targeting)).toHaveLength(10)
  })

  it('respects boss exclusion and same-rarity constraints', () => {
    const bossExcluded: CardTargeting = {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '',
      excludeBoss: true,
    }
    const sameRarity: CardTargeting = {
      mode: 'choose',
      minTargets: 3,
      maxTargets: 3,
      prompt: '',
      excludeBoss: true,
      requireSameRarity: true,
    }
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) =>
        index < 3 ? { ...monster, rarity: 'common' as const } : { ...monster },
      ),
    }

    expect(enumerateTargetSets(initialState, bossExcluded)).toHaveLength(3)
    expect(enumerateTargetSets(state, sameRarity)).toEqual([
      ['slot-1', 'slot-2', 'slot-3'],
    ])
    expect(targetSetIsValid(state, sameRarity, ['slot-1', 'slot-2', 'slot-4'])).toBe(false)
  })

  it('requires one selected group from every eligible rarity when configured', () => {
    const targeting: CardTargeting = {
      mode: 'observedRandom',
      minTargets: 1,
      maxTargets: 3,
      prompt: '',
      excludeBoss: true,
      maxPerRarity: 1,
      requireEachEligibleRarity: true,
    }

    expect(enumerateTargetSets(initialState, targeting)).toEqual([
      ['slot-1', 'slot-2', 'slot-3'],
    ])
    expect(targetSetIsValid(initialState, targeting, ['slot-1', 'slot-2'])).toBe(false)
  })

  it('recommends a non-construct target when transforming the only construct would break synergy', () => {
    const persistent = persistentCards.find((card) => card.id === 'beast-tendon-cord')!
    const card = candidateCards.find((item) => item.id === 'awakened-anesthetic-tincture')!
    const state: GameState = {
      round: 3,
      mode: 'strategic',
      monsters: [
        { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
        { id: 'slot-2', race: 'swarm', rarity: 'common', quantity: 2, unitActivity: 50 },
        { id: 'slot-3', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-4', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      ],
    }

    const result = rankCards(state, [card], persistent)[0]

    expect(result.recommendedTargetIds).toEqual(['slot-2'])
    expect(result.scoreDelta).toBe(8)
    expect(result.analysis).toContain('已比较 2 种合法目标组合')
    expect(result.analysis).toContain('建议目标：槽位 2')
  })

  it('projects explicitly enumerable random targets but not random races', () => {
    const randomTargetCard = candidateCards.find((item) => item.id === 'brain-fog-tincture')!
    const randomRaceCard = candidateCards.find((item) => item.id === 'green-bile-solution')!

    const randomTargetResult = rankCards(initialState, [randomTargetCard], persistentCards[0])[0]
    const randomRaceResult = rankCards(initialState, [randomRaceCard], persistentCards[0])[0]

    expect(randomTargetResult.recommendedTargetIds).toBeUndefined()
    expect(randomRaceResult.recommendedTargetIds).toBeUndefined()
    expect(randomTargetResult.warnings).toEqual([])
    expect(randomTargetResult.analysis[0]).toContain('随机结果活性范围')
    expect(randomRaceResult.warnings).toContain('需要先勾选怪物目标')
  })
})
