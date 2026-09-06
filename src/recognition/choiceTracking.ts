import type { PersistentCard } from '../types/game'

export interface ChoiceRecord {
  id: string
  round: number
  phase: string
  name: string
  cardIndex: number
  status: 'selected' | 'confirm-clicked' | 'transition-observed' | 'uncertain' | 'manual' | 'ignored'
  targetSlots: number[]
  reason?: string
}
export interface ChoiceTrackingState {
  enabled: boolean
  hookActive: boolean
  message: string
  pending: ChoiceRecord | null
  records: ChoiceRecord[]
}

export function validChoiceRecords(value: unknown): ChoiceRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((r): r is ChoiceRecord => r && typeof r.id === 'string' && r.id.length <= 100
    && typeof r.name === 'string' && r.name.length <= 80 && Number.isInteger(r.round)
    && typeof r.phase === 'string' && Number.isInteger(r.cardIndex) && r.cardIndex >= 0 && r.cardIndex < 5
    && ['selected','confirm-clicked','transition-observed','uncertain','manual','ignored'].includes(r.status)
    && Array.isArray(r.targetSlots) && r.targetSlots.every((n: number) => Number.isInteger(n) && n >= 1 && n <= 6)).slice(-100)
}

export function choicePermanent(record: ChoiceRecord, cards: readonly PersistentCard[]): PersistentCard | undefined {
  if (record.phase !== 'surgeryRewardSelection') return undefined
  const normalize = (name: string) => name.normalize('NFKC').replace(/\s/g, '')
  // Automatic writes use exact names/explicit aliases, not fuzzy card matching.
  const matches = cards.filter(c => c.id !== 'none' && [c.name, ...(c.aliases ?? [])]
    .some(name => normalize(name) === normalize(record.name)))
  return matches.length === 1 ? matches[0] : undefined
}

export function receiveChoices(log: ChoiceRecord[], incoming: ChoiceRecord[], ids: string[], cards: readonly PersistentCard[]) {
  const seen = new Set(log.map(r => r.id))
  const fresh = validChoiceRecords(incoming).filter(r => !seen.has(r.id) && Boolean(seen.add(r.id)))
  const nextIds = new Set(ids.filter(id => id !== 'none'))
  for (const record of fresh) {
    const card = choicePermanent(record, cards)
    if (record.status === 'transition-observed' && card) nextIds.add(card.id)
  }
  return { log: [...log, ...fresh].slice(-100), ids: nextIds.size ? [...nextIds] : ['none'], changed: fresh.length > 0 }
}
