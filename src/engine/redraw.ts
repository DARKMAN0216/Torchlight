import type {
  CandidateCard,
  GameState,
  PersistentLoadout,
  RedrawEstimate,
} from '../types/game'
import { rankCards } from './evaluate'

function binomial(total: number, selected: number): number {
  if (selected < 0 || selected > total) return 0
  const count = Math.min(selected, total - selected)
  let result = 1
  for (let index = 1; index <= count; index += 1) {
    result = (result * (total - count + index)) / index
  }
  return Math.round(result)
}

export function estimateRedraw(
  state: GameState,
  pool: CandidateCard[],
  persistent: PersistentLoadout,
  drawCount: number,
  currentBest: number,
): RedrawEstimate {
  const actualCount = Math.min(drawCount, pool.length)
  if (actualCount === 0) {
    return {
      drawCount,
      expectedBest: currentBest,
      expectedDelta: 0,
      improveProbability: 0,
      minimumBest: currentBest,
      maximumBest: currentBest,
      sampleCount: 1,
    }
  }

  const sortedScores = rankCards(state, pool, persistent)
    .map((result) => result.score)
    .sort((left, right) => left - right)
  const sampleCount = binomial(sortedScores.length, actualCount)
  let weightedBestTotal = 0
  let improvedHands = 0

  // 对有序分数中的第 i 张牌，它作为一手牌最大下标出现的组合数是 C(i, k - 1)。
  // 这样可精确计算所有不重复抽取的最大值分布，无需创建 C(n, k) 个牌组。
  for (let index = actualCount - 1; index < sortedScores.length; index += 1) {
    const handCount = binomial(index, actualCount - 1)
    const best = Math.max(currentBest, sortedScores[index])
    weightedBestTotal += best * handCount
    if (best > currentBest) improvedHands += handCount
  }

  const expectedBest = weightedBestTotal / sampleCount
  const minimumBest = Math.max(currentBest, sortedScores[actualCount - 1])
  const maximumBest = Math.max(currentBest, sortedScores.at(-1) ?? currentBest)

  return {
    drawCount,
    expectedBest,
    expectedDelta: expectedBest - currentBest,
    improveProbability: improvedHands / sampleCount,
    minimumBest,
    maximumBest,
    sampleCount,
  }
}
