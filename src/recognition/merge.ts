import { rarityIds, type CandidateCard, type GameState } from '../types/game'
import type { PersistentCard } from '../types/game'
import type { RecognitionScreenPhase, RecognitionSnapshot, RecognizedValue } from './contracts'
import { validateRecognitionConsistency } from './validation'

const confidenceThreshold = 0.72
const candidatePhases = new Set<RecognitionScreenPhase>([
  'potionSelection',
  'expandedPotionSelection',
  'candidateSelection',
])
const persistentChoicePhases = new Set<RecognitionScreenPhase>([
  'surgeryPreparation',
  'surgeryRewardSelection',
])

export interface RecognitionMergeResult {
  state: GameState
  candidateIds: string[]
  offerCount: 3 | 5
  phase: RecognitionScreenPhase
  appliedFieldCount: number
  matchedCandidateCount: number
  persistentOffers: PersistentOffer[]
  matchedPersistentCount: number
  confirmedCandidateIds: string[]
  unmatchedCandidateNames: string[]
  warnings: string[]
}

export interface PersistentOffer {
  name: string
  cardId?: string
  confidence: number
}

function normalizeName(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s·•・—–_-]/g, '')
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

export function candidateNameSimilarity(recognizedName: string, actualName: string): number {
  const left = normalizeName(recognizedName)
  const right = normalizeName(actualName)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.94
  return 1 - editDistance(left, right) / Math.max(left.length, right.length)
}

export function matchCandidateName(
  recognizedName: RecognizedValue<string>,
  catalog: readonly CandidateCard[],
): { card?: CandidateCard; confidence: number } {
  let bestCard: CandidateCard | undefined
  let bestSimilarity = 0
  for (const card of catalog) {
    const similarity = candidateNameSimilarity(recognizedName.value, card.name)
    if (similarity > bestSimilarity) {
      bestCard = card
      bestSimilarity = similarity
    }
  }
  const confidence = bestSimilarity * recognizedName.confidence
  return confidence >= confidenceThreshold
    ? { card: bestCard, confidence }
    : { confidence }
}

export function matchPersistentName(
  recognizedName: RecognizedValue<string>,
  catalog: readonly PersistentCard[],
): { card?: PersistentCard; confidence: number } {
  let bestCard: PersistentCard | undefined
  let bestSimilarity = 0
  for (const card of catalog) {
    if (card.id === 'none') continue
    const similarity = Math.max(
      candidateNameSimilarity(recognizedName.value, card.name),
      ...(card.aliases ?? []).map((alias) => candidateNameSimilarity(recognizedName.value, alias)),
    )
    if (similarity > bestSimilarity) {
      bestCard = card
      bestSimilarity = similarity
    }
  }
  const confidence = bestSimilarity * recognizedName.confidence
  return confidence >= confidenceThreshold
    ? { card: bestCard, confidence }
    : { confidence }
}

export function mergeRecognitionSnapshot(
  currentState: GameState,
  currentCandidateIds: string[],
  currentOfferCount: 3 | 5,
  snapshot: RecognitionSnapshot,
  catalog: readonly CandidateCard[],
  persistentCatalog: readonly PersistentCard[] = [],
): RecognitionMergeResult {
  const warnings = [...(snapshot.diagnostics?.issues ?? [])]
  const consistency = validateRecognitionConsistency(
    snapshot.monsterSlots ?? [],
    snapshot.displayedFinalActivity?.value,
  )
  warnings.push(...consistency.issues)
  const monsterSnapshotRejected = consistency.matchesDisplayedTotal === false
  const review: string[] = snapshot.monsterSlots?.length
    ? [] : [...(currentState.recognitionReview ?? [])]
  if (monsterSnapshotRejected) review.push('怪物数值与画面总活性不一致，请核对六个槽位后确认')

  let appliedFieldCount = 0
  const round = snapshot.round && snapshot.round.confidence >= confidenceThreshold
    ? snapshot.round.value
    : currentState.round
  if (round !== currentState.round) appliedFieldCount += 1

  const slotsById = new Map(snapshot.monsterSlots?.map((slot) => [slot.slotId, slot]) ?? [])
  const monsters = currentState.monsters.map((monster) => {
    if (monsterSnapshotRejected) return monster
    const recognizedSlot = slotsById.get(monster.id)
    if (!recognizedSlot || recognizedSlot.occupied.confidence < confidenceThreshold) {
      if (snapshot.monsterSlots?.length) review.push(`${monster.id} 是否有怪物尚未确认`)
      return monster
    }
    if (!recognizedSlot.occupied.value) {
      if (consistency.matchesDisplayedTotal !== true) {
        review.push(`${monster.id} 空槽尚未通过总活性校验`)
        return monster
      }
      if (monster.race) appliedFieldCount += 3
      return { ...monster, race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 }
    }

    const next = { ...monster }
    if (recognizedSlot.raceId && recognizedSlot.raceId.confidence >= confidenceThreshold) {
      if (next.race !== recognizedSlot.raceId.value) appliedFieldCount += 1
      next.race = recognizedSlot.raceId.value
    } else {
      review.push(`${monster.id} 种群未可靠识别，显示值待核对`)
    }
    if (recognizedSlot.rarity && recognizedSlot.rarity.confidence >= confidenceThreshold
      && rarityIds.includes(recognizedSlot.rarity.value)) {
      if (next.rarity !== recognizedSlot.rarity.value) appliedFieldCount += 1
      // A new observed occupant may be lower rarity than the old saved occupant.
      // The boss cap applies to card effects, not authoritative screen observations.
      next.rarity = recognizedSlot.rarity.value
    } else {
      review.push(`${monster.id} 稀有度未可靠识别，显示值待核对`)
    }
    if (recognizedSlot.quantity && recognizedSlot.quantity.confidence >= confidenceThreshold) {
      if (next.quantity !== recognizedSlot.quantity.value) appliedFieldCount += 1
      next.quantity = recognizedSlot.quantity.value
    }
    if (recognizedSlot.unitActivity && recognizedSlot.unitActivity.confidence >= confidenceThreshold) {
      if (next.unitActivity !== recognizedSlot.unitActivity.value) appliedFieldCount += 1
      next.unitActivity = recognizedSlot.unitActivity.value
    }
    if (!next.race && (next.quantity > 0 || next.unitActivity > 0)) {
      warnings.push(`${monster.id} 已识别数值但种群未知，保留为空槽等待人工确认`)
    }
    return next
  })

  const phase = snapshot.phase?.value ?? 'unknown'
  let offerCount = currentOfferCount
  let candidateIds = [...currentCandidateIds]
  let matchedCandidateCount = 0
  let persistentOffers: PersistentOffer[] = []
  let matchedPersistentCount = 0
  const confirmedCandidateIds: string[] = []
  const unmatchedCandidateNames: string[] = []
  const names = snapshot.candidateCardNames ?? []
  if (candidatePhases.has(phase) && (names.length === 3 || names.length === 5)) {
    offerCount = names.length
    candidateIds = [...currentCandidateIds]
    for (let index = 0; index < names.length; index += 1) {
      const match = matchCandidateName(names[index], catalog)
      if (match.card) {
        candidateIds[index] = match.card.id
        matchedCandidateCount += 1
        confirmedCandidateIds.push(match.card.id)
      } else {
        unmatchedCandidateNames.push(names[index].value)
        warnings.push(`未能可靠匹配第 ${index + 1} 张候选“${names[index].value}”`)
      }
    }
  } else if (persistentChoicePhases.has(phase) && names.length === 3) {
    persistentOffers = names.map((name, index) => {
      const match = matchPersistentName(name, persistentCatalog)
      if (match.card) {
        matchedPersistentCount += 1
        return { name: name.value, cardId: match.card.id, confidence: match.confidence }
      }
      warnings.push(`未能可靠匹配第 ${index + 1} 张常驻手术用具“${name.value}”`)
      return { name: name.value, confidence: name.confidence }
    })
  } else if (phase === 'surgeryPlanSelection' && round > 10) {
    warnings.push('当前为第 10 回合后的手术方案，选择权保留给玩家；已跳过方案卡')
  } else if (phase === 'surgeryPlanSelection') {
    warnings.push('当前为手术方案阶段，但回合未超过 10；未自动跳过，请人工确认阶段')
  } else if (names.length > 0 && !candidatePhases.has(phase)) {
    warnings.push(`识别到 ${names.length} 张非药剂卡，未覆盖当前候选牌`)
  } else if (candidatePhases.has(phase)) {
    warnings.push(`只识别到 ${names.length} 个卡名，尚未形成完整的三卡或五卡候选；请重新截图或手动录入`)
  }

  return {
    state: { ...currentState, round, monsters, recognitionReview: [...new Set(review)] },
    candidateIds,
    offerCount,
    phase,
    appliedFieldCount,
    matchedCandidateCount,
    persistentOffers,
    matchedPersistentCount,
    confirmedCandidateIds,
    unmatchedCandidateNames,
    warnings: [...new Set([...review, ...warnings])],
  }
}
