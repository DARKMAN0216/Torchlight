import { describe, expect, it } from 'vitest'
import { candidateCards, persistentCards } from '../data/sampleLibrary'
import type { CandidateCard, GameState } from '../types/game'
import { rankCards } from './evaluate'
import { evaluateStrategicState } from './strategy'

function oneConstructState(mode: GameState['mode']): GameState {
  return {
    round: 3,
    mode,
    monsters: [
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      { id: 'slot-3', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      { id: 'slot-4', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      { id: 'slot-5', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      { id: 'slot-6', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
    ],
  }
}

describe('strategic value model', () => {
  it('values progress toward the two-construct persistent threshold', () => {
    const persistent = persistentCards.find((card) => card.id === 'beast-tendon-cord')!
    const oneGroup = evaluateStrategicState(oneConstructState('strategic'), persistent)
    const twoGroupState = {
      ...oneConstructState('strategic'),
      monsters: oneConstructState('strategic').monsters.map((monster, index) =>
        index === 1
          ? { ...monster, race: 'construct' as const, quantity: 73 }
          : monster,
      ),
    }
    const twoGroups = evaluateStrategicState(twoGroupState, persistent)

    expect(twoGroups.value - oneGroup.value).toBe(186)
    expect(twoGroups.analysis).toContain('骨卫兵启动门槛：2/2 组，协同 +240')
  })

  it('keeps the only construct instead of taking a slightly higher immediate conversion', () => {
    const persistent = persistentCards.find((card) => card.id === 'beast-tendon-cord')!
    const safeCard: CandidateCard = {
      id: 'preserve-construct-test',
      name: '保留骨卫兵测试卡',
      rarity: 1,
      description: '',
      tags: [],
      effects: [{ type: 'addActivity', target: 'construct', amount: 10 }],
    }
    const cards = [
      safeCard,
      candidateCards.find((card) => card.id === 'aberrant-conversion')!,
    ]

    const immediateRanking = rankCards(oneConstructState('activity'), cards, persistent)
    const strategicRanking = rankCards(oneConstructState('strategic'), cards, persistent)

    expect(immediateRanking[0].card.id).toBe('aberrant-conversion')
    expect(immediateRanking[0].delta).toBe(32)
    expect(strategicRanking[0].card.id).toBe('preserve-construct-test')
    expect(strategicRanking.at(-1)!.card.id).toBe('aberrant-conversion')
    expect(strategicRanking.at(-1)!.scoreDelta).toBeLessThan(0)
  })

  it('rewards a completed same-rarity set for black goat suture', () => {
    const persistent = persistentCards.find((card) => card.id === 'black-goat-suture')!
    const state = oneConstructState('strategic')
    state.monsters[1] = {
      id: 'slot-2',
      race: 'swarm',
      rarity: 'common',
      quantity: 1,
      unitActivity: 0,
    }
    const twoGroups = evaluateStrategicState(state, persistent)
    state.monsters[2] = {
      id: 'slot-3',
      race: 'awakened',
      rarity: 'common',
      quantity: 1,
      unitActivity: 0,
    }
    const threeGroups = evaluateStrategicState(state, persistent)

    expect(threeGroups.value - twoGroups.value).toBe(131)
    expect(threeGroups.analysis).toContain('同稀有度三连：最大同稀有度组 3/3，协同 +175')
  })

  it('scales contracted claw anchor value with the retained construct activity', () => {
    const persistent = persistentCards.find((card) => card.id === 'contracted-claw')!
    const result = evaluateStrategicState(oneConstructState('strategic'), persistent)

    expect(result.ruleValue).toBe(200)
    expect(result.analysis).toContain('骨卫兵路线资产：路线核心活性 200 × 0.4，协同 +80')
  })
})
