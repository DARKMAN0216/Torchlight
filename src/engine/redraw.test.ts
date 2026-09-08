import { describe, expect, it } from 'vitest'
import { candidateCards, initialState, persistentCards } from '../data/sampleLibrary'
import type { CandidateCard } from '../types/game'
import { rankCards } from './evaluate'
import { estimateRedraw } from './redraw'

function bruteForceBestValues(
  pool: CandidateCard[],
  drawCount: number,
  currentBest: number,
): number[] {
  const scores = rankCards(initialState, pool, persistentCards[0])
    .map((result) => result.score)
  const values: number[] = []

  const walk = (start: number, selected: number[]) => {
    if (selected.length === drawCount) {
      values.push(Math.max(currentBest, ...selected))
      return
    }
    for (let index = start; index <= scores.length - (drawCount - selected.length); index += 1) {
      selected.push(scores[index])
      walk(index + 1, selected)
      selected.pop()
    }
  }

  walk(0, [])
  return values
}

describe('redraw estimate', () => {
  it('does not treat missing passive model data as zero redraw value', () => {
    const state = { ...initialState, round: 2 }
    const estimate = estimateRedraw(state, candidateCards, persistentCards.find(p => p.id === 'plague-madonna')!, 3, 100)
    expect(estimate.unavailable).toContain('缺少结算数据')
    expect(estimate.sampleCount).toBe(0)
  })
  it('matches brute-force enumeration without materializing every hand', () => {
    const pool = candidateCards.filter(c=>!c.confirmedPotion).slice(0, 8)
    const currentBest = 100
    const exact = estimateRedraw(initialState, pool, persistentCards[0], 3, currentBest)
    const bruteForce = bruteForceBestValues(pool, 3, currentBest)
    const improved = bruteForce.filter((value) => value > currentBest).length

    expect(exact.sampleCount).toBe(bruteForce.length)
    expect(exact.expectedBest).toBeCloseTo(
      bruteForce.reduce((sum, value) => sum + value, 0) / bruteForce.length,
      10,
    )
    expect(exact.improveProbability).toBeCloseTo(improved / bruteForce.length, 10)
    expect(exact.minimumBest).toBe(Math.min(...bruteForce))
    expect(exact.maximumBest).toBe(Math.max(...bruteForce))
  })

  it('returns the current best for an empty pool', () => {
    expect(estimateRedraw(initialState, [], persistentCards[0], 5, 321)).toEqual({
      drawCount: 5,
      expectedBest: 321,
      expectedDelta: 0,
      improveProbability: 0,
      minimumBest: 321,
      maximumBest: 321,
      sampleCount: 1,
    })
  })
})
