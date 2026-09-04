import { useEffect, useMemo, useRef, useState } from 'react'
import {
  candidateCards,
  initialCandidateIds,
  initialState,
  persistentCards,
} from './data/sampleLibrary'
import { estimateRedraw } from './engine/redraw'
import { evaluateCard, rankCards, totalActivity } from './engine/evaluate'
import { applyOpportunityPolicy } from './engine/opportunity'
import { persistentCardsIn, persistentLoadoutName } from './engine/persistent'
import { hasEligibleTargetSet, targetIsDisabled, targetSetIsValid } from './engine/targeting'
import { CandidateCardView } from './components/CandidateCardView'
import { FlaskIcon, AddIcon, BookIcon, SaveIcon, ScanIcon, SettingsIcon, UndoIcon } from './components/Icons'
import { CardCatalogDialog } from './components/CardCatalogDialog'
import { RecommendationPanel } from './components/RecommendationPanel'
import { RedrawStrip } from './components/RedrawStrip'
import { StatePanel } from './components/StatePanel'
import { localScreenRecognitionProvider } from './recognition/localBridge'
import { mergeRecognitionSnapshot } from './recognition/merge'
import type { RecognitionSnapshot } from './recognition/contracts'
import {
  raceIds,
  type CandidateCard,
  type DecisionMode,
  type GameState,
  type PersistentLoadout,
  type RaceId,
} from './types/game'

const storageKey = 'vorax-decision-assistant-state-v4'
const legacyV3StorageKey = 'vorax-decision-assistant-state-v3'
const legacyV2StorageKey = 'vorax-decision-assistant-state-v2'
const legacyStorageKey = 'vorax-decision-assistant-state-v1'
const candidateCardById = new Map(candidateCards.map((card) => [card.id, card]))
const persistentCardById = new Map(persistentCards.map((card) => [card.id, card]))
const mappedRealCardCount = candidateCards.filter((card) => card.tags.includes('真实卡牌')).length

interface SavedWorkspace {
  state: GameState
  persistentIds: string[]
  candidateIds: string[]
  offerCount: 3 | 5
  rerollsRemaining?: number
  awaitingEndRound?: boolean
}

interface LegacyV3Workspace {
  state: GameState
  persistentId: string
  candidateIds: string[]
  offerCount: 3 | 5
  awaitingEndRound?: boolean
}

interface HistoryEntry {
  state: GameState
  awaitingEndRound: boolean
  candidateIds: string[]
  offerCount: 3 | 5
  rerollsRemaining: number
}

type PendingResolution =
  | { kind: 'candidate'; cardId: string }
  | { kind: 'roundEnd' }

interface LegacyWorkspace {
  state: {
    round: number
    mode: DecisionMode
    monsters: Record<RaceId, { quantity: number; activity: number }>
  }
  persistentId: string
  candidateIds: string[]
  offerCount: 3 | 5
}

interface LegacyV2Workspace extends Omit<LegacyV3Workspace, 'state'> {
  state: Omit<GameState, 'monsters'> & {
    monsters: Array<Omit<GameState['monsters'][number], 'unitActivity'> & { activity: number }>
  }
}

function legacyUnitActivity(quantity: number, groupActivity: number): number {
  return quantity > 0 ? Math.round(groupActivity / quantity) : 0
}

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
  if (!value || typeof value !== 'object') return false
  const workspace = value as Partial<SavedWorkspace>
  return Boolean(
    workspace.state &&
    Array.isArray(workspace.state.monsters) &&
    workspace.state.monsters.length === 6 &&
    workspace.state.monsters.every((monster) => Number.isFinite(monster.unitActivity)) &&
    Array.isArray(workspace.persistentIds) &&
    Array.isArray(workspace.candidateIds),
  )
}

function migrateV2Workspace(legacy: LegacyV2Workspace): SavedWorkspace {
  return {
    persistentIds: [legacy.persistentId],
    candidateIds: legacy.candidateIds,
    offerCount: legacy.offerCount,
    awaitingEndRound: legacy.awaitingEndRound,
    state: {
      ...legacy.state,
      monsters: legacy.state.monsters.map(({ activity, ...monster }) => ({
        ...monster,
        unitActivity: legacyUnitActivity(monster.quantity, activity),
      })),
    },
  }
}

function migrateLegacyWorkspace(legacy: LegacyWorkspace): SavedWorkspace {
  return {
    state: {
      round: legacy.state.round,
      mode: legacy.state.mode,
      monsters: [
        ...raceIds.map((race, index) => ({
          id: `slot-${index + 1}`,
          race,
          rarity: 'common' as const,
          quantity: legacy.state.monsters[race]?.quantity ?? 0,
          unitActivity: legacyUnitActivity(
            legacy.state.monsters[race]?.quantity ?? 0,
            legacy.state.monsters[race]?.activity ?? 0,
          ),
        })),
        { id: 'slot-5', race: null, rarity: 'common', quantity: 0, unitActivity: 0 } as const,
        { id: 'slot-6', race: null, rarity: 'common', quantity: 0, unitActivity: 0 } as const,
      ],
    },
    persistentIds: [legacy.persistentId],
    candidateIds: legacy.candidateIds,
    offerCount: legacy.offerCount,
    awaitingEndRound: false,
  }
}

function readSavedWorkspace(): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isSavedWorkspace(parsed)) return parsed
    }
    const v3Raw = localStorage.getItem(legacyV3StorageKey)
    if (v3Raw) {
      const legacy = JSON.parse(v3Raw) as LegacyV3Workspace
      return {
        state: legacy.state,
        persistentIds: [legacy.persistentId],
        candidateIds: legacy.candidateIds,
        offerCount: legacy.offerCount,
        awaitingEndRound: legacy.awaitingEndRound,
      }
    }
    const v2Raw = localStorage.getItem(legacyV2StorageKey)
    if (v2Raw) return migrateV2Workspace(JSON.parse(v2Raw) as LegacyV2Workspace)
    const legacyRaw = localStorage.getItem(legacyStorageKey)
    return legacyRaw ? migrateLegacyWorkspace(JSON.parse(legacyRaw) as LegacyWorkspace) : null
  } catch {
    return null
  }
}

function removalTriggerCount(
  state: GameState,
  persistent: PersistentLoadout,
  removedIds: string[],
): number {
  return persistentCardsIn(persistent).reduce((count, card) => {
    const trigger = card.onRemovalQuantityBonus
    if (!trigger) return count
    return count + removedIds.filter((id) => {
      const race = state.monsters.find((monster) => monster.id === id)?.race
      return race && (!trigger.excludedRace || race !== trigger.excludedRace)
    }).length
  }, 0)
}

function resolutionObservationIsValid(
  state: GameState,
  card: CandidateCard,
  persistent: PersistentLoadout,
  primaryIds: string[],
  removedIds: string[],
  triggerTargetIds: string[],
): boolean {
  const removal = card.resolutionObservation?.removals
  if (!removal) return true
  const primaryRaces = new Set(
    state.monsters
      .filter((monster) => primaryIds.includes(monster.id))
      .map((monster) => monster.race),
  )
  const removalCandidates = state.monsters.filter((monster) =>
    monster.race &&
    !primaryIds.includes(monster.id) &&
    (!removal.differentRaceFromPrimaryTarget || !primaryRaces.has(monster.race)),
  )
  const requiredRemovalCount = removal.allowFewerWhenUnavailable
    ? Math.min(removal.count, removalCandidates.length)
    : removal.count
  if (
    removedIds.length !== requiredRemovalCount ||
    new Set(removedIds).size !== requiredRemovalCount
  ) return false

  const removalsValid = removedIds.every((id) => {
    const monster = state.monsters.find((item) => item.id === id)
    return Boolean(
      monster?.race &&
      !primaryIds.includes(id) &&
      (!removal.differentRaceFromPrimaryTarget || !primaryRaces.has(monster.race)),
    )
  })
  if (!removalsValid) return false

  const requiredTriggers = removalTriggerCount(state, persistent, removedIds)
  if (triggerTargetIds.length !== requiredTriggers) return false
  return triggerTargetIds.every((id) => {
    const monster = state.monsters.find((item) => item.id === id)
    return Boolean(monster?.race && !removedIds.includes(id))
  })
}

function App() {
  const [saved] = useState(() => readSavedWorkspace())
  const [state, setState] = useState<GameState>(() => saved?.state ?? initialState)
  const [persistentIds, setPersistentIds] = useState<string[]>(
    () => saved?.persistentIds ?? ['none'],
  )
  const [candidateIds, setCandidateIds] = useState<string[]>(
    () => saved?.candidateIds ?? initialCandidateIds,
  )
  const [offerCount, setOfferCount] = useState<3 | 5>(() => saved?.offerCount ?? 5)
  const [rerollsRemaining, setRerollsRemaining] = useState(
    () => saved?.rerollsRemaining ?? 3,
  )
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [status, setStatus] = useState('屏幕识别版 · 启动本地识别服务后可自动回填')
  const [recognitionBusy, setRecognitionBusy] = useState(false)
  const recognitionFileInput = useRef<HTMLInputElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null)
  const [selectedMonsterIds, setSelectedMonsterIds] = useState<string[]>([])
  const [observedRaceByMonsterId, setObservedRaceByMonsterId] = useState<Partial<Record<string, RaceId>>>({})
  const [observedNewGroupRaces, setObservedNewGroupRaces] = useState<Array<RaceId | ''>>([])
  const [observedRemovedMonsterIds, setObservedRemovedMonsterIds] = useState<Array<string | ''>>([])
  const [observedPersistentTriggerTargetIds, setObservedPersistentTriggerTargetIds] = useState<Array<string | ''>>([])
  const [awaitingEndRound, setAwaitingEndRound] = useState(
    () => saved?.awaitingEndRound ?? false,
  )

  const resetObservedResolution = (card?: CandidateCard) => {
    setObservedRemovedMonsterIds(
      card?.resolutionObservation?.removals
        ? Array.from({ length: card.resolutionObservation.removals.count }, () => '')
        : [],
    )
    setObservedPersistentTriggerTargetIds([])
  }

  const selectedPersistentCards = useMemo(
    () => persistentIds
      .map((id) => persistentCardById.get(id))
      .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    [persistentIds],
  )
  const persistentLoadout = selectedPersistentCards.length > 0
    ? selectedPersistentCards
    : [persistentCards[0]]
  const roundEndPersistent = selectedPersistentCards.find((card) => card.roundEndEffect)
  const removalTriggerPersistent = selectedPersistentCards.find(
    (card) => card.onRemovalQuantityBonus,
  )
  const offeredCards = useMemo(
    () => candidateIds
      .slice(0, offerCount)
      .map((id) => candidateCardById.get(id) ?? candidateCards[0]),
    [candidateIds, offerCount],
  )
  const roundEndCard = useMemo<CandidateCard | undefined>(() => {
    const effect = roundEndPersistent?.roundEndEffect
    if (!effect) return undefined
    return {
      id: `round-end:${roundEndPersistent.id}`,
      name: `${roundEndPersistent.name}·回合结束`,
      rarity: 3,
      description: effect.description,
      tags: ['常驻卡', '回合结束'],
      effects: effect.effects,
      targeting: effect.targeting,
    }
  }, [roundEndPersistent])
  const roundEndDue = Boolean(
    roundEndCard &&
    (!roundEndPersistent?.roundEndEffect?.everyRounds ||
      state.round % roundEndPersistent.roundEndEffect.everyRounds === 0),
  )
  const evaluationContext = useMemo(() => ({
    selectedMonsterIds,
    observedRaceByMonsterId,
    observedNewGroupRaces: observedNewGroupRaces.filter((race): race is RaceId => Boolean(race)),
    observedRemovedMonsterIds: observedRemovedMonsterIds.filter(Boolean) as string[],
    observedPersistentTriggerTargetIds: observedPersistentTriggerTargetIds.filter(Boolean) as string[],
  }), [
    selectedMonsterIds,
    observedRaceByMonsterId,
    observedNewGroupRaces,
    observedRemovedMonsterIds,
    observedPersistentTriggerTargetIds,
  ])
  const baseRanking = useMemo(
    () => rankCards(state, offeredCards, persistentLoadout, evaluationContext),
    [state, offeredCards, persistentLoadout, evaluationContext],
  )
  const opportunityDecision = useMemo(
    () => applyOpportunityPolicy(baseRanking, rerollsRemaining),
    [baseRanking, rerollsRemaining],
  )
  const ranking = opportunityDecision.ranking
  const currentBest = ranking[0]?.score ?? totalActivity(state)
  const redraw3 = useMemo(
    () => estimateRedraw(state, candidateCards, persistentLoadout, 3, currentBest),
    [state, persistentLoadout, currentBest],
  )

  useEffect(() => {
    const workspace: SavedWorkspace = {
      state,
      persistentIds,
      candidateIds,
      offerCount,
      rerollsRemaining,
      awaitingEndRound,
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(workspace))
    } catch {
      setStatus('浏览器未允许自动保存，当前局面仅保留在本次会话')
    }
  }, [state, persistentIds, candidateIds, offerCount, rerollsRemaining, awaitingEndRound])

  const setCandidateAt = (index: number, id: string) => {
    setCandidateIds((current) => {
      const next = [...current]
      next[index] = id
      return next
    })
  }

  const startNewGame = () => {
    setHistory([])
    setState(initialState)
    setPersistentIds(['none'])
    setCandidateIds(initialCandidateIds)
    setOfferCount(5)
    setRerollsRemaining(3)
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setAwaitingEndRound(false)
    setStatus('已新建牌局，当前使用示例数据')
  }

  const pendingCard = pendingResolution?.kind === 'candidate'
    ? candidateCardById.get(pendingResolution.cardId)
    : pendingResolution?.kind === 'roundEnd'
      ? roundEndCard
      : undefined
  const disabledTargetIds = pendingCard?.targeting
    ? state.monsters
        .filter((monster) => targetIsDisabled(
          monster.id,
          state,
          pendingCard.targeting!,
          selectedMonsterIds,
        ))
        .map((monster) => monster.id)
    : []
  const observedResolutionComplete = pendingCard
    ? resolutionObservationIsValid(
        state,
        pendingCard,
        persistentLoadout,
        selectedMonsterIds,
        observedRemovedMonsterIds.filter(Boolean) as string[],
        observedPersistentTriggerTargetIds.filter(Boolean) as string[],
      )
    : true

  const applyCard = (
    cardId: string,
    targetIds: string[] = [],
    observedRacesById: Partial<Record<string, RaceId>> = {},
    newGroupRaces: RaceId[] = [],
    removedMonsterIds: string[] = [],
    persistentTriggerTargetIds: string[] = [],
  ) => {
    const card = candidateCardById.get(cardId)
    if (!card) return
    if (card.followUpOfferCount) {
      const expandedIds = candidateCards
        .filter((candidate) => !candidate.followUpOfferCount)
        .slice(0, card.followUpOfferCount)
        .map((candidate) => candidate.id)
      setHistory((current) => [...current, {
        state,
        awaitingEndRound,
        candidateIds,
        offerCount,
        rerollsRemaining,
      }])
      setCandidateIds(expandedIds)
      setOfferCount(card.followUpOfferCount)
      setPendingResolution(null)
      setSelectedMonsterIds([])
      setObservedRaceByMonsterId({})
      setObservedNewGroupRaces([])
      resetObservedResolution()
      setStatus(`已展开“${card.name}”，本轮不推进；请录入实际出现的 ${card.followUpOfferCount} 张药剂`)
      document.querySelector('.candidate-workspace')?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const result = evaluateCard(state, card, persistentLoadout, {
      selectedMonsterIds: targetIds,
      observedRaceByMonsterId: observedRacesById,
      observedNewGroupRaces: newGroupRaces,
      observedRemovedMonsterIds: removedMonsterIds,
      observedPersistentTriggerTargetIds: persistentTriggerTargetIds,
    })
    setHistory((current) => [...current, { state, awaitingEndRound, candidateIds, offerCount, rerollsRemaining }])
    setState({ ...result.state, round: roundEndDue ? state.round : state.round + 1 })
    setAwaitingEndRound(roundEndDue)
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus(
      roundEndDue
        ? `已结算“${card.name}”，请继续结算“${roundEndPersistent?.name}”的回合结束效果`
        : `已结算“${card.name}”，请录入下一轮候选卡`,
    )
  }

  const beginApplyCard = (cardId: string, suggestedTargetIds: string[] = []) => {
    if (awaitingEndRound) {
      setStatus(`请先结算“${roundEndPersistent?.name}”的回合结束效果`)
      return
    }
    const card = candidateCardById.get(cardId)
    if (!card) return
    if (!card.targeting) {
      applyCard(cardId)
      return
    }
    setPendingResolution({ kind: 'candidate', cardId })
    setSelectedMonsterIds(suggestedTargetIds)
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces(
      card.targeting.observedRaces?.mode === 'newGroups'
        ? Array.from({ length: card.targeting.observedRaces.count }, () => '')
        : [],
    )
    setObservedRemovedMonsterIds(
      card.resolutionObservation?.removals
        ? Array.from({ length: card.resolutionObservation.removals.count }, () => '')
        : [],
    )
    setObservedPersistentTriggerTargetIds([])
    setStatus(
      suggestedTargetIds.length
        ? `${card.name}：已预选模型建议目标，可确认或重新选择`
        : `${card.name}：${card.targeting.prompt}`,
    )
    document.querySelector('.state-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const applyRecommendation = () => {
    const best = ranking[0]
    if (best) beginApplyCard(best.card.id, best.recommendedTargetIds)
  }

  const toggleMonsterTarget = (id: string) => {
    if (!pendingCard?.targeting) return
    resetObservedResolution(pendingCard)
    setSelectedMonsterIds((current) => {
      if (current.includes(id)) {
        setObservedRaceByMonsterId((observed) => {
          const next = { ...observed }
          delete next[id]
          return next
        })
        return current.filter((item) => item !== id)
      }
      if (targetIsDisabled(id, state, pendingCard.targeting!, current)) return current
      return [...current, id]
    })
  }

  const setObservedRaceForTarget = (monsterId: string, race: RaceId | '') => {
    setObservedRaceByMonsterId((current) => {
      const next = { ...current }
      if (race) next[monsterId] = race
      else delete next[monsterId]
      return next
    })
  }

  const setObservedRaceForNewGroup = (index: number, race: RaceId | '') => {
    setObservedNewGroupRaces((current) => {
      const next = [...current]
      next[index] = race
      return next
    })
  }

  const setObservedRemovedTarget = (index: number, monsterId: string | '') => {
    setObservedRemovedMonsterIds((current) => {
      const next = [...current]
      next[index] = monsterId
      const completeIds = next.filter(Boolean) as string[]
      const count = removalTriggerCount(state, persistentLoadout, completeIds)
      setObservedPersistentTriggerTargetIds((targets) =>
        Array.from({ length: count }, (_, targetIndex) => targets[targetIndex] ?? ''),
      )
      return next
    })
  }

  const setObservedPersistentTriggerTarget = (index: number, monsterId: string | '') => {
    setObservedPersistentTriggerTargetIds((current) => {
      const next = [...current]
      next[index] = monsterId
      return next
    })
  }

  const confirmTargetSelection = () => {
    if (!pendingCard?.targeting) return
    if (!targetSetIsValid(state, pendingCard.targeting, selectedMonsterIds)) return
    const observedRaces = pendingCard.targeting.observedRaces
    if (
      observedRaces?.mode === 'perTarget' &&
      selectedMonsterIds.some((id) => !observedRaceByMonsterId[id])
    ) return
    if (
      observedRaces?.mode === 'newGroups' &&
      observedNewGroupRaces.some((race) => !race)
    ) return
    const removedIds = observedRemovedMonsterIds.filter(Boolean) as string[]
    const triggerTargetIds = observedPersistentTriggerTargetIds.filter(Boolean) as string[]
    if (!resolutionObservationIsValid(
      state,
      pendingCard,
      persistentLoadout,
      selectedMonsterIds,
      removedIds,
      triggerTargetIds,
    )) return
    if (pendingResolution?.kind === 'roundEnd') {
      applyRoundEnd(selectedMonsterIds)
    } else {
      applyCard(
        pendingCard.id,
        selectedMonsterIds,
        observedRaceByMonsterId,
        observedNewGroupRaces.filter((race): race is RaceId => Boolean(race)),
        removedIds,
        triggerTargetIds,
      )
    }
  }

  const applyRoundEnd = (targetIds: string[] = []) => {
    if (!roundEndCard || !awaitingEndRound) return
    const result = evaluateCard(state, roundEndCard, persistentLoadout, {
      selectedMonsterIds: targetIds,
    })
    const repeat = Boolean(
      roundEndPersistent?.roundEndEffect?.repeatWhileEligible &&
      hasEligibleTargetSet(result.state, roundEndPersistent.roundEndEffect.targeting),
    )
    setHistory((current) => [...current, { state, awaitingEndRound, candidateIds, offerCount, rerollsRemaining }])
    setState({ ...result.state, round: repeat ? state.round : state.round + 1 })
    setAwaitingEndRound(repeat)
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus(
      repeat
        ? `“${roundEndPersistent?.name}”仍有另一组符合条件的怪物，请继续结算`
        : `已结算“${roundEndPersistent?.name}”的回合结束效果，进入下一轮`,
    )
  }

  const beginRoundEnd = () => {
    if (!roundEndCard || !awaitingEndRound) return
    if (!roundEndCard.targeting) {
      applyRoundEnd()
      return
    }
    setPendingResolution({ kind: 'roundEnd' })
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus(`${roundEndCard.name}：${roundEndCard.targeting.prompt}`)
    document.querySelector('.state-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const skipRoundEnd = () => {
    if (!awaitingEndRound) return
    setHistory((current) => [...current, { state, awaitingEndRound, candidateIds, offerCount, rerollsRemaining }])
    setState({ ...state, round: state.round + 1 })
    setAwaitingEndRound(false)
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus(`“${roundEndPersistent?.name}”本轮无可触发目标，已进入下一轮`)
  }

  const cancelTargetSelection = () => {
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus(
      awaitingEndRound
        ? `已取消目标选择，仍需结算“${roundEndPersistent?.name}”的回合结束效果`
        : '已取消本次卡牌结算',
    )
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setState(previous.state)
    setAwaitingEndRound(previous.awaitingEndRound)
    setCandidateIds(previous.candidateIds)
    setOfferCount(previous.offerCount)
    setRerollsRemaining(previous.rerollsRemaining)
    setHistory((current) => current.slice(0, -1))
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setStatus('已撤销上一次应用')
  }

  const saveWorkspace = () => {
    const workspace: SavedWorkspace = {
      state,
      persistentIds,
      candidateIds,
      offerCount,
      rerollsRemaining,
      awaitingEndRound,
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(workspace))
      setStatus(`局面已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch {
      setStatus('保存失败：浏览器未提供本地存储权限')
    }
  }

  const useReroll = () => {
    if (rerollsRemaining <= 0) {
      setStatus('本局 3 次洗牌机会已经用完')
      return
    }
    setHistory((current) => [...current, {
      state,
      awaitingEndRound,
      candidateIds,
      offerCount,
      rerollsRemaining,
    }])
    const nextRemaining = rerollsRemaining - 1
    setRerollsRemaining(nextRemaining)
    setOfferCount(3)
    setStatus(`已使用 1 次洗牌，剩余 ${nextRemaining}/3；请录入新的 3 张候选卡`)
    document.querySelector('.candidate-workspace')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handlePersistentToggle = (id: string) => {
    if (awaitingEndRound || pendingResolution) return
    setPersistentIds((current) => {
      if (id === 'none') return ['none']
      const withoutNone = current.filter((item) => item !== 'none')
      const next = withoutNone.includes(id)
        ? withoutNone.filter((item) => item !== id)
        : [...withoutNone, id]
      return next.length > 0 ? next : ['none']
    })
  }

  const applyRecognition = (snapshot: RecognitionSnapshot) => {
    const result = mergeRecognitionSnapshot(
      state,
      candidateIds,
      offerCount,
      snapshot,
      candidateCards,
    )
    const changed = result.appliedFieldCount > 0 || result.matchedCandidateCount > 0
    if (changed) {
      setHistory((current) => [...current, {
        state,
        awaitingEndRound,
        candidateIds,
        offerCount,
        rerollsRemaining,
      }])
      setState(result.state)
      setCandidateIds(result.candidateIds)
      setOfferCount(result.offerCount)
      setPendingResolution(null)
      setSelectedMonsterIds([])
      setObservedRaceByMonsterId({})
      setObservedNewGroupRaces([])
      resetObservedResolution()
    }

    const latency = snapshot.diagnostics?.latencyMs
      ? ` · ${Math.round(snapshot.diagnostics.latencyMs)} ms`
      : ''
    const warning = result.warnings.length > 0
      ? ` · ${result.warnings[0]}`
      : ''
    setStatus(
      `识别完成：回填 ${result.appliedFieldCount} 个状态字段，匹配 ${result.matchedCandidateCount} 张候选${latency}${warning}`,
    )
  }

  const recognizeScreen = async () => {
    if (recognitionBusy) return
    setRecognitionBusy(true)
    setStatus('正在截取主屏幕并进行本地识别…')
    try {
      if (!await localScreenRecognitionProvider.isAvailable()) {
        throw new Error('本地识别服务未启动，请先运行 .\\scripts\\start-recognition.ps1')
      }
      applyRecognition(await localScreenRecognitionProvider.captureAndRecognize())
    } catch (error) {
      setStatus(`识别失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRecognitionBusy(false)
    }
  }

  const recognizeImage = async (file: File) => {
    if (recognitionBusy) return
    setRecognitionBusy(true)
    setStatus(`正在识别截图“${file.name}”…`)
    try {
      if (!await localScreenRecognitionProvider.isAvailable()) {
        throw new Error('本地识别服务未启动，请先运行 .\\scripts\\start-recognition.ps1')
      }
      applyRecognition(await localScreenRecognitionProvider.recognizeImage(file))
    } catch (error) {
      setStatus(`识别失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRecognitionBusy(false)
      if (recognitionFileInput.current) recognitionFileInput.current.value = ''
    }
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="brand">
          <FlaskIcon />
          <span>渴瘾决策器</span>
          <em>本地识别版</em>
        </div>
        <nav aria-label="牌局操作">
          <button type="button" onClick={recognizeScreen} disabled={recognitionBusy}>
            <ScanIcon /> {recognitionBusy ? '识别中…' : '识别屏幕'}
          </button>
          <button
            type="button"
            onClick={() => recognitionFileInput.current?.click()}
            disabled={recognitionBusy}
          >
            导入截图
          </button>
          <input
            ref={recognitionFileInput}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void recognizeImage(file)
            }}
          />
          <button type="button" onClick={startNewGame}>
            <AddIcon /> 新牌局
          </button>
          <button type="button" onClick={saveWorkspace}>
            <SaveIcon /> 保存局面
          </button>
          <button type="button" onClick={() => setCatalogOpen(true)}>
            <BookIcon /> 真实卡库 84
          </button>
          <button type="button" onClick={undo} disabled={history.length === 0}>
            <UndoIcon /> 撤销
          </button>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)}>
            <SettingsIcon /> 设置
          </button>
        </nav>
      </header>

      {settingsOpen && (
        <div className="settings-banner">
          <strong>当前估算假设</strong>
          <span>屏幕识别：先运行 .\scripts\start-recognition.ps1；“识别屏幕”读取主显示器，“导入截图”可识别已保存图片。</span>
          <span>当前常驻组合：{persistentLoadoutName(persistentLoadout)}。手术用具按追加关系共同参与评分。</span>
          <span>重抽来自完整示例牌库、等概率、同一批不重复。真实规则录入后可替换。</span>
          <span>战略基础权重：每个有效怪物组 +6；魔法/稀有/首领分别 +8/+20/+36；常驻卡成型条件使用独立协同权重。</span>
          <span>回合结束转移：只计可确认的结构变化，每释放 1 个槽位暂记 +12；随机结果不等价时按保守下界计算。</span>
          <button type="button" onClick={() => setSettingsOpen(false)}>关闭</button>
        </div>
      )}

      {catalogOpen && <CardCatalogDialog onClose={() => setCatalogOpen(false)} />}

      <main className="app-grid">
        <StatePanel
          state={state}
          persistentIds={persistentIds}
          persistentCards={persistentCards}
          onStateChange={setState}
          onPersistentToggle={handlePersistentToggle}
          persistentLocked={awaitingEndRound || Boolean(pendingResolution)}
          roundEndAction={roundEndCard ? {
            description: roundEndPersistent!.roundEndEffect!.description,
            due: roundEndDue,
            awaiting: awaitingEndRound,
            everyRounds: roundEndPersistent?.roundEndEffect?.everyRounds,
            onResolve: beginRoundEnd,
            onSkip: skipRoundEnd,
          } : undefined}
          targetSelection={pendingCard?.targeting ? {
            cardName: pendingCard.name,
            prompt: pendingCard.targeting.prompt,
            mode: pendingCard.targeting.mode,
            selectedIds: selectedMonsterIds,
            minTargets: pendingCard.targeting.minTargets,
            maxTargets: pendingCard.targeting.maxTargets,
            valid: targetSetIsValid(state, pendingCard.targeting, selectedMonsterIds),
            excludeBoss: pendingCard.targeting.excludeBoss ?? false,
            disabledIds: disabledTargetIds,
            observedRaces: pendingCard.targeting.observedRaces,
            resolutionObservation: pendingCard.resolutionObservation,
            resolutionComplete: observedResolutionComplete,
            observedRaceByMonsterId,
            observedNewGroupRaces,
            observedRemovedMonsterIds,
            observedPersistentTriggerTargetIds,
            persistentRemovalTrigger: removalTriggerPersistent?.onRemovalQuantityBonus,
            onToggle: toggleMonsterTarget,
            onObservedTargetRaceChange: setObservedRaceForTarget,
            onObservedNewGroupRaceChange: setObservedRaceForNewGroup,
            onObservedRemovedTargetChange: setObservedRemovedTarget,
            onObservedPersistentTriggerTargetChange: setObservedPersistentTriggerTarget,
            onConfirm: confirmTargetSelection,
            onCancel: cancelTargetSelection,
          } : undefined}
        />

        <div className="center-column">
          <section className="panel candidate-workspace">
            <div className="panel-heading candidate-heading">
              <div>
                <h1>当前候选卡 <span>({offerCount}/{offerCount})</span></h1>
                <p>选择每个槽位实际出现的卡牌，结果会立即重算</p>
              </div>
              <div className="offer-switch" aria-label="候选卡数量">
                {[3, 5].map((count) => (
                  <button
                    type="button"
                    key={count}
                    className={offerCount === count ? 'selected' : ''}
                    onClick={() => setOfferCount(count as 3 | 5)}
                  >
                    {count} 张
                  </button>
                ))}
              </div>
            </div>
            <div className={`candidate-grid count-${offerCount}`}>
              {offeredCards.map((card, index) => {
                const result = rankCards(state, [card], persistentLoadout, evaluationContext)[0]
                return (
                  <CandidateCardView
                    key={`${index}-${card.id}`}
                    slotIndex={index}
                    card={card}
                    cards={candidateCards}
                    result={result}
                    recommended={ranking[0]?.card.id === card.id}
                    pending={pendingResolution?.kind === 'candidate' && pendingResolution.cardId === card.id}
                    disabled={awaitingEndRound}
                    onCardChange={(id) => setCandidateAt(index, id)}
                    onApply={() => beginApplyCard(card.id, result.recommendedTargetIds)}
                  />
                )
              })}
            </div>
          </section>

          <RedrawStrip
            currentBest={currentBest}
            scoreLabel={ranking[0]?.scoreLabel ?? '即时活性'}
            estimate3={redraw3}
            rerollsRemaining={rerollsRemaining}
            recommended={opportunityDecision.preferRedraw}
            onReroll={useReroll}
          />
        </div>

        <RecommendationPanel
          ranking={ranking}
          onApply={applyRecommendation}
          disabled={awaitingEndRound}
        />
      </main>

      <footer className="status-bar">
        <span><i />{status}</span>
        <span>真实卡库：84 张已载入 · {mappedRealCardCount} 张候选卡已映射 · 多常驻战略模型已启用</span>
      </footer>
    </div>
  )
}

export default App
