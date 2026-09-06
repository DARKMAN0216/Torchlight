import type { GameState, RaceId } from '../types/game'
import { openingRacesForName } from '../data/openingCardRaces'

/**
 * A route-fit hint, NOT an effect eligibility check: e.g. contracted claw
 * prefers a construct route but removing a swarm can still trigger it.
 * Generic/unknown routes deliberately prevent a blanket mismatch warning.
 */
export function openingRouteMismatch(
  state: GameState,
  choices: readonly { name: string; confidence?: number }[],
): RaceId[] | null {
  if (state.round !== 1 || state.recognitionReview?.length || choices.length !== 3) return null
  const monsters = state.monsters.filter((monster) => monster.race && monster.quantity > 0)
  if (!monsters.length) return null
  const routes = new Set<RaceId>()
  for (const card of choices) {
    if (card.confidence !== undefined && (!Number.isFinite(card.confidence) || card.confidence < 0.85)) return null
    const races = openingRacesForName(card.name)
    if (!races?.length) return null
    for (const race of races) routes.add(race)
  }
  return monsters.some((monster) => routes.has(monster.race!)) ? null : [...routes]
}
