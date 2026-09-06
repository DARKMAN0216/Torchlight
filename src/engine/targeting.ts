import type { CardTargeting, GameState, MonsterGroup } from '../types/game'

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

function eligibleMonsters(state: GameState, targeting: CardTargeting): MonsterGroup[] {
  return state.monsters.filter((monster) =>
    monster.race && monster.quantity > 0 &&
    !(targeting.excludeBoss && monster.rarity === 'boss') &&
    (!targeting.allowedRarities || targeting.allowedRarities.includes(monster.rarity)),
  )
}

export function targetSetIsValid(
  state: GameState,
  targeting: CardTargeting,
  targetIds: string[],
): boolean {
  if (targetIds.length < targeting.minTargets || targetIds.length > targeting.maxTargets) {
    return false
  }
  const uniqueIds = new Set(targetIds)
  if (uniqueIds.size !== targetIds.length) return false
  const targets = eligibleMonsters(state, targeting).filter((monster) => uniqueIds.has(monster.id))
  if (targets.length !== targetIds.length) return false
  if (targeting.requireSameRarity && targets.some((target) => target.rarity !== targets[0].rarity)) {
    return false
  }
  if (targeting.maxPerRarity) {
    const counts = new Map<MonsterGroup['rarity'], number>()
    for (const target of targets) {
      const count = (counts.get(target.rarity) ?? 0) + 1
      if (count > targeting.maxPerRarity) return false
      counts.set(target.rarity, count)
    }
  }
  if (targeting.requireEachEligibleRarity) {
    const eligibleRarities = new Set(
      eligibleMonsters(state, targeting).map((monster) => monster.rarity),
    )
    const selectedRarities = new Set(targets.map((monster) => monster.rarity))
    if (
      selectedRarities.size !== eligibleRarities.size ||
      [...eligibleRarities].some((rarity) => !selectedRarities.has(rarity))
    ) return false
  }
  return true
}

export function enumerateTargetSets(
  state: GameState,
  targeting: CardTargeting,
): string[][] {
  const ids = eligibleMonsters(state, targeting).map((monster) => monster.id)
  const sets: string[][] = []
  for (let count = targeting.minTargets; count <= targeting.maxTargets; count += 1) {
    for (const targetIds of combinations(ids, count)) {
      if (targetSetIsValid(state, targeting, targetIds)) sets.push(targetIds)
    }
  }
  return sets
}

export function targetIsDisabled(
  monsterId: string,
  state: GameState,
  targeting: CardTargeting,
  selectedIds: string[],
): boolean {
  if (selectedIds.includes(monsterId)) return false
  const monster = state.monsters.find((item) => item.id === monsterId)
  if (!monster?.race) return true
  if (targeting.excludeBoss && monster.rarity === 'boss') return true
  if (targeting.allowedRarities && !targeting.allowedRarities.includes(monster.rarity)) return true
  if (selectedIds.length >= targeting.maxTargets) return true

  const selected = state.monsters.filter((item) => selectedIds.includes(item.id))
  if (targeting.requireSameRarity && selected[0]?.rarity !== undefined) {
    if (monster.rarity !== selected[0].rarity) return true
  }
  if (targeting.maxPerRarity) {
    const sameRarityCount = selected.filter((item) => item.rarity === monster.rarity).length
    if (sameRarityCount >= targeting.maxPerRarity) return true
  }
  return false
}

export function hasEligibleTargetSet(state: GameState, targeting?: CardTargeting): boolean {
  return targeting ? enumerateTargetSets(state, targeting).length > 0 : true
}
