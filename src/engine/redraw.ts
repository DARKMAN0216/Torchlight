import type {
  CandidateCard,
  GameState,
  PersistentLoadout,
  RedrawEstimate,
} from '../types/game'
import { rankCards } from './evaluate'

function combinations<T>(items: T[], count: number): T[][] {
  if (count <= 0) return [[]]
  if (count > items.length) return []
  const output: T[][] = []

  const walk = (start: number, current: T[]) => {
    if (current.length === count) {
      output.push([...current])
      return
    }
    for (let index = start; index <= items.length - (count - current.length); index += 1) {
      current.push(items[index])
      walk(index + 1, current)
      current.pop()
    }
  }

  walk(0, [])
  return output
}

export function estimateRedraw(
  state: GameState,
  pool: CandidateCard[],
  persistent: PersistentLoadout,
  drawCount: number,
  currentBest: number,
): RedrawEstimate {
  const actualCount = Math.min(drawCount, pool.length)
  const hands = combinations(pool, actualCount)
  const scoreByCardId = new Map(
    rankCards(state, pool, persistent).map((result) => [result.card.id, result.score]),
  )
  const bestValues = hands.map((hand) => hand.reduce(
    (best, card) => Math.max(best, scoreByCardId.get(card.id) ?? currentBest),
    currentBest,
  ))
  const expectedBest =
    bestValues.reduce((sum, value) => sum + value, 0) / Math.max(1, bestValues.length)
  const improved = bestValues.filter((value) => value > currentBest).length
  const minimumBest = bestValues.reduce(
    (minimum, value) => Math.min(minimum, value),
    Number.POSITIVE_INFINITY,
  )
  const maximumBest = bestValues.reduce(
    (maximum, value) => Math.max(maximum, value),
    Number.NEGATIVE_INFINITY,
  )

  return {
    drawCount,
    expectedBest,
    expectedDelta: expectedBest - currentBest,
    improveProbability: improved / Math.max(1, bestValues.length),
    minimumBest,
    maximumBest,
    sampleCount: bestValues.length,
  }
}
