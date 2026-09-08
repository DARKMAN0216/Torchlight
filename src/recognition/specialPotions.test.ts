import { expect, it } from 'vitest'
import { mergeRecognitionSnapshot } from './merge'
import { candidateCards, initialState } from '../data/sampleLibrary'
import type { GameState } from '../types/game'
import type { RecognitionSnapshot } from './contracts'
import { fromLegacyState, fromRecognitionSnapshot } from '../planner/observations'
import { cocoonId } from '../planner/specialPotions'
import { validateUserData, workspaceKey } from '../storage/userData'

const v = <T>(value: T) => ({ value, confidence: 1 })
const old = (): GameState => ({ ...initialState, round: 4, monsters: initialState.monsters.map((m, i) => ({
  id: m.id, race: i ? null : 'swarm', rarity: i ? 'common' : 'boss', quantity: i ? 0 : 100, unitActivity: i ? 0 : 20,
  ...(i ? {} : { specialIdentity: 'hollow-cocoon' as const }),
})) })
const snapshot = (name: string | undefined = '空心茧'): RecognitionSnapshot => ({
  capturedAt: '2026-09-08T00:00:00Z', round: v(4), phase: v('potionSelection'), candidateCardIds: [],
  displayedFinalActivity: v(2000), monsterSlots: old().monsters.map((m, i) => i
    ? { slotId: m.id, occupied: v(false) }
    : { slotId: m.id, occupied: v(true), raceId: v('swarm'), rarity: v('boss'), quantity: v(100), unitActivity: v(20),
      ...(name ? { name: v(name) } : {}) }),
})
const merge = (frame: RecognitionSnapshot) => mergeRecognitionSnapshot(old(), [], 3, frame, candidateCards)
it('recognizes a cocoon by exact name, not merely race and rarity', () => {
  expect(merge(snapshot()).state.monsters[0].specialIdentity).toBe('hollow-cocoon')
  expect(merge(snapshot('未收录首领')).state.monsters[0].specialIdentity).toBe('unknown')
  const frame = snapshot('已知首领')
  expect(mergeRecognitionSnapshot(old(), [], 3, frame, candidateCards, [], [
    { name: '已知首领', race: 'swarm', rarity: 'boss' },
  ]).state.monsters[0].specialIdentity).toBe('ordinary')
})
it('clears stale cocoon identity on mutation, empty slot, or unconfirmed name', () => {
  const changed = snapshot('蝎兽')
  expect(merge(changed).state.monsters[0]).toMatchObject({ race: 'aberrant', rarity: 'common' })
  expect(merge(changed).state.monsters[0].specialIdentity).toBeUndefined()
  const missing = snapshot(); delete missing.monsterSlots![0].name
  expect(merge(missing).state.monsters[0].specialIdentity).toBe('unknown')
  const empty = snapshot(); empty.monsterSlots![0] = { slotId: 'slot-1', occupied: v(false) }; empty.displayedFinalActivity = v(0)
  expect(merge(empty).state.monsters[0].specialIdentity).toBeUndefined()
})
it('retains three ordinary candidates plus one extra in a four-card observation', () => {
  const names = ['生骨药粉','卵壳药粉','活性育卵激素','子三代：破茧蝶群']
  const frame = snapshot(); frame.candidateCardNames = names.map(v)
  const result = merge(frame)
  expect(result.offerCount).toBe(4)
  expect(result.matchedCandidateCount).toBe(4)
  expect(result.candidateIds.map(id => candidateCards.find(c => c.id === id)!.name)).toEqual(names)
  expect(result.warnings.some(w => w.includes('尚未形成'))).toBe(false)
})
it('carries identity into planner observations without reusing a stale predicted cocoon', () => {
  const state = fromLegacyState(old(), { offeredCardIds: ['test'], persistentEffects: [], redrawsRemaining: 3, specialPotionStage: 0 })
  expect(state.slots[0].monster!.monsterId).toBe(cocoonId)
  const frame = snapshot(); frame.candidateCardIds = [v('test')]; frame.persistentCardIds = []; frame.rerollsRemaining = v(3)
  expect(fromRecognitionSnapshot(state, frame).slots[0].monster!.monsterId).toBe(cocoonId)
  frame.monsterSlots![0].name = v('其他首领')
  expect(fromRecognitionSnapshot(state, frame).slots[0].monster!.monsterId).not.toBe(cocoonId)
})
it('validates special identity persistence and rejects impossible cocoon class', () => {
  const payload = { state: old(), persistentIds: [], candidateIds: [], offerCount: 4 }
  expect(() => validateUserData(workspaceKey, JSON.stringify(payload))).not.toThrow()
  payload.state.monsters[0].race = 'construct'
  expect(() => validateUserData(workspaceKey, JSON.stringify(payload))).toThrow('格式无效')
})
