import type { RecognitionSnapshot } from './contracts'
import type { FollowState } from './localBridge'

export function followNeedsSynchronization(follow: FollowState | null, online: boolean | null): boolean {
  return Boolean(follow?.enabled && (online !== true || !['following', 'checking'].includes(follow.status)))
}

export function synchronizationCopy(text: string, following = false): string {
  return following ? text.replace(/按\s*F8\s*同步/g, '等待自动同步').replace(/F8同步/g, '自动同步') : text
}

/** Timing/confidence changes alone must not create another undo history entry. */
export function snapshotIdentity(snapshot: RecognitionSnapshot): string {
  return JSON.stringify({
    phase: snapshot.phase?.value, round: snapshot.round?.value,
    rerolls: snapshot.rerollsRemaining?.value, total: snapshot.displayedFinalActivity?.value,
    cards: snapshot.candidateCardNames?.map(c => c.value), ids: snapshot.candidateCardIds.map(c => c.value),
    slots: snapshot.monsterSlots?.map(s => [s.slotId,s.occupied.value,s.name?.value,s.raceId?.value,s.rarity?.value,s.quantity?.value,s.unitActivity?.value]),
  })
}
