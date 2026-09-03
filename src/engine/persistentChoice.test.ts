import { describe, expect, it } from 'vitest'
import { persistentCards } from '../data/sampleLibrary'
import type { GameState } from '../types/game'
import { rankPersistentChoices } from './persistentChoice'

describe('persistent reward choice model', () => {
  it('recommends dirty bone scraper for the observed second surgery reward', () => {
    const state: GameState = {
      round: 4,
      mode: 'strategic',
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct', rarity: 'common', quantity: 316, unitActivity: 45 },
        { id: 'slot-3', race: 'awakened', rarity: 'rare', quantity: 162, unitActivity: 176 },
        { id: 'slot-4', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((card) =>
      ['contracted-claw', 'writhing-spinal'].includes(card.id),
    )
    const choices = persistentCards.filter((card) => [
      'leather-restraint',
      'dirty-bone-scraper',
      'clustered-insect-eggs',
    ].includes(card.id))
    const ranking = rankPersistentChoices(state, choices, loadout)

    expect(ranking[0].card.id).toBe('dirty-bone-scraper')
    expect(ranking[0].nextRoundEndBonus).toBe(6320)
    expect(ranking[0].scoreDelta).toBe(6320)
    expect(ranking[0].analysis).toContainEqual(
      expect.stringContaining('脏污刮骨刀'),
    )
    expect(ranking[0].analysis[0]).toContain('下一回合结束')
    expect(ranking.slice(1).map((result) => result.scoreDelta)).toEqual([0, 0])
  })
})
