import type { GameState, PersistentCard, PersistentLoadout } from '../types/game'
import { evaluateRoundEndTransition } from './evaluate'
import { persistentCardsIn } from './persistent'
import { evaluateStrategicState } from './strategy'

export interface PersistentChoiceEvaluation {
  modelUnavailable?: string
  card: PersistentCard
  score: number
  scoreDelta: number
  nextRoundEndBonus: number
  analysis: string[]
}

function strategicScore(state: GameState, loadout: PersistentLoadout): {
  unavailable?: string
  score: number
  roundEndBonus: number
  analysis: string[]
} {
  const strategic = evaluateStrategicState(state, loadout)
  const transition = evaluateRoundEndTransition(state, loadout)
  return {
    unavailable: transition.unavailable,
    score: strategic.value + transition.bonus,
    roundEndBonus: transition.bonus,
    analysis: [...strategic.analysis, ...transition.analysis],
  }
}

export function rankPersistentChoices(
  state: GameState,
  choices: readonly PersistentCard[],
  currentLoadout: PersistentLoadout,
): PersistentChoiceEvaluation[] {
  const currentCards = persistentCardsIn(currentLoadout)
  const nextRound = { ...state, round: state.round + 1 }
  const before = strategicScore(nextRound, currentCards)

  return choices
    .map((card) => {
      const after = strategicScore(nextRound, currentCards.some(item => item.id === card.id)
        ? currentCards : [...currentCards, card])
      return {
        modelUnavailable: before.unavailable || after.unavailable,
        card,
        score: after.score,
        scoreDelta: after.score - before.score,
        nextRoundEndBonus: after.roundEndBonus - before.roundEndBonus,
        analysis: [
          '新获得的常驻不会追溯结算当前奖励回合；以下收益从下一回合结束开始投射',
          ...after.analysis,
        ],
      }
    })
    .sort((left, right) =>
      Number(Boolean(left.modelUnavailable)) - Number(Boolean(right.modelUnavailable)) || right.score - left.score || right.nextRoundEndBonus - left.nextRoundEndBonus,
    )
}
