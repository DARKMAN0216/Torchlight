import { raceIds, type CandidateCard, type EvaluationResult, type GameState, type PersistentLoadout, type RaceId } from '../types/game'
import { persistentCardsIn } from './persistent'
import { enumerateTargetSets } from './targeting'

export function raceCounts(state: GameState, race: RaceId): number {
  return state.monsters.filter(m => m.race === race && m.quantity > 0).length
}

/** Bounds only: never count endpoint frequencies as random probabilities. */
export function raceRanges(outcomes: EvaluationResult[]): EvaluationResult['raceGroupRange'] {
  return Object.fromEntries(raceIds.map(race => [race, {
    minimum: Math.min(...outcomes.map(r => r.raceGroupRange?.[race]?.minimum ?? raceCounts(r.state, race))),
    maximum: Math.max(...outcomes.map(r => r.raceGroupRange?.[race]?.maximum ?? raceCounts(r.state, race))),
  }]))
}

export function startupNeed(state: GameState, loadout: PersistentLoadout) {
  // Focus on an actual missing race-count engine, not the independent opening warning.
  // Stop route-first planning in the final potion round; no invented future draws.
  if (state.round < 1 || state.round >= 10 || state.recognitionReview?.length) return null
  const dormant = persistentCardsIn(loadout).filter(p => p.roundEndQuantityPerRaceGroup &&
    raceCounts(state, p.roundEndQuantityPerRaceGroup.race) === 0)
  const races = [...new Set(dormant.map(p => p.roundEndQuantityPerRaceGroup!.race))]
  if (races.length !== 1) return null // No arbitrary tie-break between conflicting engines.
  return { race: races[0], passiveNames: dormant.map(p => p.name) }
}

export function withStartup(state: GameState, loadout: PersistentLoadout, result: EvaluationResult): EvaluationResult {
  if (result.modelUnavailable || result.sampledOutcomes) return { ...result, startup: undefined }
  const need = startupNeed(state, loadout)
  if (!need) return result
  const range = result.raceGroupRange?.[need.race] ?? {
    minimum: raceCounts(result.state, need.race), maximum: raceCounts(result.state, need.race),
  }
  const hasUnprojectedAddMutation = !result.raceGroupRange &&
    result.card.effects.some(e => e.type === 'addGroup' || e.type === 'addObservedGroups' || e.type === 'mergeSelected') &&
    persistentCardsIn(loadout).some(p => p.onAddGroupExpectedMutation && p.onAddGroupExpectedMutation.toRace !== need.race)
  return { ...result, startup: { ...need, minimumGroups: range.minimum, maximumGroups: range.maximum,
    ...(hasUnprojectedAddMutation ? { minimumGroups: 0 } : {}),
    // Do not blindly sacrifice a valuable board/other passive to seek a missing race.
    safeForPriority: (result.activityRange?.minimum ?? result.activityAfter) >= result.activityBefore && result.scoreDelta >= 0 && range.maximum > 0,
  } }
}

export function compareStartup(a: EvaluationResult, b: EvaluationResult): number {
  const tier = (r: EvaluationResult) => !r.startup?.safeForPriority ? 0 : r.startup.minimumGroups > 0 ? 2 : 1
  const tierDelta = tier(b) - tier(a)
  if (tierDelta) return tierDelta
  // More final groups is a route preference only, not an inferred success probability.
  if (tier(a) > 0) return (b.startup!.minimumGroups - a.startup!.minimumGroups) || (b.startup!.maximumGroups - a.startup!.maximumGroups)
  return 0
}

/** Unquantified replacements get an explicit exploration option, never a fake score. */
export function replacementExploration(state: GameState, card: CandidateCard, race: RaceId) {
  if (!card.randomReplacementCount || !card.targeting) return null
  const active = state.monsters.filter(m => m.race && m.quantity > 0)
  const slots = state.monsters.filter(m => m.race === null).length
  const options = enumerateTargetSets(state, card.targeting).map(ids => ({
    ids,
    opportunities: Math.min(card.randomReplacementCount!, slots + ids.length),
    removedActivity: active.filter(m => ids.includes(m.id)).reduce((s, m) => s + m.quantity * m.unitActivity, 0),
    removesAnchor: active.some(m => ids.includes(m.id) && m.race === race),
  })).filter(o => !o.removesAnchor)
  options.sort((a,b) => a.removedActivity - b.removedActivity || b.opportunities - a.opportunities || a.ids.length - b.ids.length)
  return options[0] ?? null
}
