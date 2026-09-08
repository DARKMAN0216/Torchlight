import { describe, expect, it } from 'vitest'
import { candidateCards, persistentCards } from '../data/sampleLibrary'
import type { GameState, PersistentCard } from '../types/game'
import { evaluateRoundEndTransition, rankCards } from './evaluate'

function stateWith(groups: GameState['monsters'], round = 2): GameState {
  const emptySlots = Array.from({ length: 6 - groups.length }, (_, index) => ({
    id: `slot-${groups.length + index + 1}`,
    race: null,
    rarity: 'common' as const,
    quantity: 0,
    unitActivity: 0,
  }))
  return { round, mode: 'strategic', monsters: [...groups, ...emptySlots], persistentModel: {
    monsters: [{ monsterId:'test-fusion-construct',race:'construct',rarity:'magic',quantity:12,unitActivity:15 }],
    raritySamples: (['common','magic','rare'] as const).map((rarity,i) => ({
      id:`test-${i}`,cardId:'plague-madonna',beforeMonsterId:'before',afterMonsterId:'after',fromRarity:rarity,
      toRarity:(['magic','rare','boss'] as const)[i],beforeQuantity:10,afterQuantity:10,beforeUnitActivity:10,afterUnitActivity:10,
    })),
  } }
}

describe('round-end transition value', () => {
  it('credits rarity improvement and two freed slots for black goat fusion', () => {
    const persistent = persistentCards.find((card) => card.id === 'black-goat-suture')!
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: 'swarm', rarity: 'common', quantity: 2, unitActivity: 50 },
      { id: 'slot-3', race: 'awakened', rarity: 'common', quantity: 1, unitActivity: 25 },
    ])

    const projection = evaluateRoundEndTransition(state, persistent)

    expect(projection.bonus).toBe(570)
    expect(projection.activityBonus).toBe(550)
    expect(projection.unavailable).toBeUndefined()
  })

  it('adds the transition value when a candidate completes the fusion threshold', () => {
    const persistent = persistentCards.find((card) => card.id === 'black-goat-suture')!
    const card = candidateCards.find((item) => item.id === 'spinal-solution-awakened')!
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: 'swarm', rarity: 'common', quantity: 2, unitActivity: 50 },
    ])

    const result = rankCards(state, [card], persistent)[0]

    expect(result.scoreDelta).toBe(2987)
    expect(result.analysis.join()).toContain('黑山羊肠缝线')
  })

  it('recognizes equivalent observed-random outcomes without guessing a target', () => {
    const persistent = persistentCards.find((card) => card.id === 'molting-cortex')!
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'magic', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: 'swarm', rarity: 'magic', quantity: 2, unitActivity: 50 },
    ])

    const projection = evaluateRoundEndTransition(state, persistent)

    expect(projection.bonus).toBe(310)
    expect(projection.analysis.join()).toContain('枚举 1 个结果')
  })

  it('uses a conservative lower bound when random outcomes have different values', () => {
    const persistent: PersistentCard = {
      id: 'random-upgrade-test',
      name: '随机升阶测试',
      description: '',
      roundEndEffect: {
        description: '',
        targeting: {
          mode: 'observedRandom',
          minTargets: 1,
          maxTargets: 1,
          prompt: '',
          excludeBoss: true,
        },
        effects: [{ type: 'upgradeRarity', target: 'selected', steps: 1 }],
      },
    }
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: 'swarm', rarity: 'magic', quantity: 2, unitActivity: 50 },
    ])

    const projection = evaluateRoundEndTransition(state, persistent)

    expect(projection.bonus).toBe(8)
    expect(projection.analysis[0]).toContain('随机结果范围 +8–+12，概率未确认，按保守下界计入')
  })

  it('does not project a periodic effect on an off-cycle round', () => {
    const persistent = persistentCards.find((card) => card.id === 'plague-madonna')!
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
    ], 3)

    expect(evaluateRoundEndTransition(state, persistent)).toMatchObject({ bonus: 0, activityBonus: 0 })
  })

  it('projects one upgrade from every occupied non-boss rarity on the due round', () => {
    const persistent = persistentCards.find((card) => card.id === 'plague-madonna')!
    const state = stateWith([
      { id: 'slot-1', race: 'construct', rarity: 'common', quantity: 2, unitActivity: 100 },
      { id: 'slot-2', race: 'swarm', rarity: 'magic', quantity: 2, unitActivity: 50 },
      { id: 'slot-3', race: 'awakened', rarity: 'rare', quantity: 1, unitActivity: 25 },
    ], 2)

    const projection = evaluateRoundEndTransition(state, persistent)

    expect(projection.bonus).toBe(36)
    expect(projection.analysis.join()).toContain('枚举 1 个结果')
  })
})
