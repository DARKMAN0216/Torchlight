import type { PersistentCard, PersistentLoadout } from '../types/game'

export function persistentCardsIn(loadout: PersistentLoadout): PersistentCard[] {
  return Array.isArray(loadout) ? [...loadout] : [loadout as PersistentCard]
}

export function persistentLoadoutName(loadout: PersistentLoadout): string {
  const names = persistentCardsIn(loadout)
    .filter((card) => card.id !== 'none')
    .map((card) => card.name)
  return names.length > 0 ? names.join(' + ') : '无常驻加成'
}
