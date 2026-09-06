import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { changeFloatingWindow, type PreviousWindowState } from './desktop/floatingWindow'
import {
  candidateCards,
  initialCandidateIds,
  initialState,
  persistentCards,
} from './data/sampleLibrary'
import { estimateRedraw } from './engine/redraw'
import { readUserData, saveUserData } from './storage/userData'
import { canEvaluateCard } from './engine/cardAvailability'
import { NewbornSwarmSettings } from './components/NewbornSwarmSettings'
import { evaluateCard, rankCards, totalActivity } from './engine/evaluate'
import { applyOpportunityPolicy } from './engine/opportunity'
import { persistentCardsIn, persistentLoadoutName } from './engine/persistent'
import { rankPersistentChoices } from './engine/persistentChoice'
import { hasEligibleTargetSet, targetIsDisabled, targetSetIsValid } from './engine/targeting'
import { CandidateCardView } from './components/CandidateCardView'
import { FlaskIcon, AddIcon, BookIcon, SaveIcon, ScanIcon, SettingsIcon, UndoIcon } from './components/Icons'
import { CardCatalogDialog } from './components/CardCatalogDialog'
import { RecommendationPanel } from './components/RecommendationPanel'
import { PersistentRecommendation } from './components/PersistentRecommendation'
import { RedrawStrip } from './components/RedrawStrip'
import { OpeningWarning } from './components/OpeningWarning'
import { SettlementSummary } from './components/SettlementSummary'
import { StatePanel } from './components/StatePanel'
import { MonsterDictionaryDialog } from './components/MonsterDictionaryDialog'
import { StartupAdvice } from './components/StartupAdvice'
import { FloatingMonsters } from './components/FloatingMonsters'
import { ChoiceJournal } from './components/ChoiceJournal'
import { choicePermanent, receiveChoices, validChoiceRecords, type ChoiceRecord, type ChoiceTrackingState } from './recognition/choiceTracking'
import { loadMonsterDictionary, monsterDictionary, normalizeMonsterName } from './recognition/monsterDictionary'
import { localScreenRecognitionProvider, type FollowState } from './recognition/localBridge'
import { followNeedsSynchronization, snapshotIdentity } from './recognition/followState'
import { mergeRecognitionSnapshot, type PersistentOffer } from './recognition/merge'
import type { RecognitionSnapshot, RecognitionScreenPhase } from './recognition/contracts'
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
  choiceLog?: ChoiceRecord[]
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
    const raw = readUserData(storageKey)
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
  const [choiceLog, setChoiceLog] = useState(() => validChoiceRecords(saved?.choiceLog))
  const [choiceTracking, setChoiceTracking] = useState<ChoiceTrackingState | null>(null)
  const receiveChoicesRef = useRef<(tracking?: ChoiceTrackingState) => void>(() => {})
  const [state, setState] = useState<GameState>(() => saved?.state ?? initialState)
  const recognitionNeedsReview = Boolean(state.recognitionReview?.length)
  const [persistentIds, setPersistentIds] = useState<string[]>(
    () => saved?.persistentIds ?? ['none'],
  )
  const [candidateIds, setCandidateIds] = useState<string[]>(
    () => saved?.candidateIds ?? initialCandidateIds,
  )
  const [offerCount, setOfferCount] = useState<3 | 5>(() => saved?.offerCount ?? 3)
  const [rerollsRemaining, setRerollsRemaining] = useState(
    () => saved?.rerollsRemaining ?? 3,
  )
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [status, setStatus] = useState('桌面客户端 · 启动本地识别服务后可自动回填')
  const [recognitionBusy, setRecognitionBusy] = useState(false)
  const [recognitionServiceOnline, setRecognitionServiceOnline] = useState<boolean | null>(null)
  const [hotkeyReady, setHotkeyReady] = useState<boolean | null>(null)
  const [hotkeyError, setHotkeyError] = useState<string | null>(null)
  const [hotkeyBusy, setHotkeyBusy] = useState(false)
  const [follow, setFollow] = useState<FollowState | null>(null)
  const lastAutoSnapshot = useRef('')
  const followControlEpoch = useRef(0)
  const protectionQueue = useRef<Promise<void>>(Promise.resolve())
  const followWaiting = followNeedsSynchronization(follow, recognitionServiceOnline)
  const [recognitionPhase, setRecognitionPhase] = useState<RecognitionScreenPhase | null>(null)
  const [recognizedCandidateIds, setRecognizedCandidateIds] = useState<string[] | null>(null)
  const [recognitionWarning, setRecognitionWarning] = useState('')
  const [persistentOffers, setPersistentOffers] = useState<PersistentOffer[]>([])
  const [floatingMode, setFloatingMode] = useState(false)
  const [floatingBusy, setFloatingBusy] = useState(false)
  const floatingInFlight = useRef(false)
  const floatingPreviousSize = useRef<PreviousWindowState | null>(null)
  const recognitionFileInput = useRef<HTMLInputElement>(null)
  const applyRecognitionRef = useRef<(snapshot: RecognitionSnapshot) => void>(() => {})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [monsterDictionaryOpen, setMonsterDictionaryOpen] = useState(false)
  const [monsterNames, setMonsterNames] = useState(loadMonsterDictionary)
  const [lastMonsterSnapshot, setLastMonsterSnapshot] = useState<RecognitionSnapshot | null>(null)
  const [recognizedMonsters, setRecognizedMonsters] = useState<GameState['monsters'] | null>(null)
  const [captureReceipt, setCaptureReceipt] = useState('尚未收到截图请求')

  useEffect(() => {
    const enabled = Boolean(follow?.enabled)
    // Serialize native calls so a fast start/pause cannot leave capture protection on.
    protectionQueue.current = protectionQueue.current.catch(() => {}).then(async () => {
      if (!isTauri()) return
      await getCurrentWindow().setContentProtected(enabled)
    }).catch(error => setStatus(`截图排除设置失败：${String(error)}；可暂停跟随使用单次识别`))
  }, [follow?.enabled])

  const monsterNameLookup = useMemo(() => monsterDictionary(monsterNames.entries), [monsterNames.entries])
  const unknownMonsterNames = lastMonsterSnapshot?.monsterSlots?.filter((slot) =>
    slot.occupied.value && (!slot.name || !monsterNameLookup.has(normalizeMonsterName(slot.name.value))),
  ).length ?? 0
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
    () => followWaiting || state.recognitionReview?.length ? [] : rankCards(state, offeredCards.filter((card) => recognizedCandidateIds === null || recognizedCandidateIds.includes(card.id)), persistentLoadout, evaluationContext),
    [state, offeredCards, persistentLoadout, evaluationContext, recognizedCandidateIds, followWaiting],
  )
  const unquantifiedCards = offeredCards.filter((card) => !canEvaluateCard(state, card)
    && (recognizedCandidateIds === null || recognizedCandidateIds.includes(card.id)))
  const coverageWarning = unquantifiedCards.length
    ? `已收录但缺规则/参数：${[...new Set(unquantifiedCards.map((card) => card.name))].join('、')}；不按零收益排名。活性育卵激素可在设置中填写新蛊虫基础属性后计算。`
    : ''
  const hasRangePreview = baseRanking.some(result => Boolean(result.activityRange) || result.settlement?.uncertain)
  const hasStartupPriority = state.mode === 'strategic' && baseRanking.some(result => result.startup?.safeForPriority)
  const candidateWarning = [recognitionWarning, coverageWarning].filter(Boolean).join(' ')
  const opportunityDecision = useMemo(
    () => unquantifiedCards.length || hasRangePreview || hasStartupPriority ? { ranking: baseRanking, preferPotionBox: false, preferRedraw: false }
      : applyOpportunityPolicy(baseRanking, rerollsRemaining),
    [baseRanking, rerollsRemaining, unquantifiedCards.length, hasRangePreview, hasStartupPriority],
  )
  const ranking = opportunityDecision.ranking
  const currentBest = ranking[0]?.score ?? totalActivity(state)
  const redraw3 = useMemo(
    () => estimateRedraw(state, hasRangePreview || hasStartupPriority || unquantifiedCards.length ? [] : candidateCards, persistentLoadout, 3, currentBest),
    [state, persistentLoadout, currentBest, hasRangePreview, hasStartupPriority, unquantifiedCards.length],
  )
  const offeredPersistentCards = useMemo(
    () => persistentOffers
      .map((offer) => offer.cardId ? persistentCardById.get(offer.cardId) : undefined)
      .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    [persistentOffers],
  )
  const persistentOfferRanking = useMemo(
    () => state.recognitionReview?.length ? [] : rankPersistentChoices(state, offeredPersistentCards, persistentLoadout),
    [state, offeredPersistentCards, persistentLoadout],
  )
  const persistentOfferResultById = useMemo(
    () => new Map(persistentOfferRanking.map((result) => [result.card.id, result])),
    [persistentOfferRanking],
  )

  useEffect(() => {
    const workspace: SavedWorkspace = {
      choiceLog,
      state,
      persistentIds,
      candidateIds,
      offerCount,
      rerollsRemaining,
      awaitingEndRound,
    }
    try {
      void saveUserData(storageKey, JSON.stringify(workspace)).catch(error =>
        setStatus(`保存失败，磁盘旧数据未覆盖：${String(error)}。请关闭其他客户端后重新打开。`))
    } catch {
      setStatus('客户端本地存储不可用，当前局面仅保留在本次会话')
    }
  }, [state, persistentIds, candidateIds, offerCount, rerollsRemaining, awaitingEndRound, choiceLog])

  const setCandidateAt = (index: number, id: string) => {
    setRecognizedCandidateIds(null)
    setRecognitionWarning('')
    setRecognitionPhase(null)
    setCandidateIds((current) => {
      const next = [...current]
      next[index] = id
      return next
    })
  }

  const startNewGame = () => {
    void localScreenRecognitionProvider.controlChoices('reset').catch(() => setStatus('新局已创建，但监听重置失败，请重启识别服务后 F8'))
    setHistory([])
    setState(initialState)
    setLastMonsterSnapshot(null)
    setPersistentIds(['none'])
    setCandidateIds(initialCandidateIds)
    setOfferCount(3)
    setPersistentOffers([])
    setRecognitionPhase(null)
    setRecognizedCandidateIds(null)
    setRecognitionWarning('')
    setRerollsRemaining(3)
    setPendingResolution(null)
    setSelectedMonsterIds([])
    setObservedRaceByMonsterId({})
    setObservedNewGroupRaces([])
    resetObservedResolution()
    setAwaitingEndRound(false)
    setStatus('已新建牌局，当前使用示例数据')
  }

  const toggleFloatingMode = async () => {
    if (floatingInFlight.current) return
    floatingInFlight.current = true
    setFloatingBusy(true)
    try {
      const enabled = !floatingMode
      floatingPreviousSize.current = await changeFloatingWindow(enabled, floatingPreviousSize.current)
      setFloatingMode(enabled)
      setStatus(enabled ? '浮窗已置顶：切回游戏后仍会显示 F8 识别与当前推荐' : '已退出浮窗模式')
    } catch (error) {
      setStatus(`浮窗切换失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      floatingInFlight.current = false
      setFloatingBusy(false)
    }
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
    if (follow?.enabled) {
      setStatus('持续跟随中，请在游戏内选择；结算后会自动同步，不在决策器重复结算')
      return
    }
    if (card.requiresScreenSync) {
      setStatus(`${card.name}提供分支范围预览，请在游戏选择后按F8同步；未将模拟结果写回局面`)
      return
    }
    if (card.evaluationUnavailable) {
      setStatus(`${card.name}尚未量化，请在游戏使用后按 F8 读取结果；未修改当前局面`)
      return
    }
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
    if (card.requiresScreenSync || !canEvaluateCard(state, card)) {
      applyCard(cardId)
      return
    }
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

  const saveWorkspace = async () => {
    const workspace: SavedWorkspace = {
      choiceLog,
      state,
      persistentIds,
      candidateIds,
      offerCount,
      rerollsRemaining,
      awaitingEndRound,
    }
    try {
      await saveUserData(storageKey, JSON.stringify(workspace))
      setStatus(`局面已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (error) {
      setStatus(`保存失败：${String(error)}；旧文件与备份保留。`)
    }
  }

  const useReroll = () => {
    if (follow?.enabled) { setStatus('请在游戏内洗牌，跟随模式会读取新牌和剩余次数'); return }
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

  const choosePersistentOffer = (id: string) => {
    const card = persistentCardById.get(id)
    if (!card || card.id === 'none') return
    void localScreenRecognitionProvider.controlChoices('reset').catch(() => {})
    setPersistentIds((current) => current.includes(id)
      ? current
      : [...current.filter((item) => item !== 'none'), id])
    setPersistentOffers([])
    setStatus(`已选择“${card.name}”并追加为常驻手术用具；收益从后续回合开始计算`)
  }

  const applyRecognition = (snapshot: RecognitionSnapshot) => {
    setLastMonsterSnapshot(snapshot)
    const result = mergeRecognitionSnapshot(
      state,
      candidateIds,
      offerCount,
      snapshot,
      candidateCards,
      persistentCards,
      monsterNames.entries,
    )
    const changed = result.appliedFieldCount > 0 || result.matchedCandidateCount > 0
      || JSON.stringify(state.recognitionReview) !== JSON.stringify(result.state.recognitionReview)
    setRecognizedMonsters(changed ? result.state.monsters : state.monsters)
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
    const newGame = Boolean(follow?.enabled && snapshot.round && snapshot.round.confidence >= .85 && snapshot.round.value < state.round)
    if (newGame) {
      setPersistentIds(['none'])
      setRerollsRemaining(3)
      setHistory([])
    }
    // A disappearance is not evidence of which permanent was chosen. Keep the
    // three known choices until the player records the actual one in the overlay.
    setPersistentOffers(current => !newGame && follow?.enabled && current.length && !result.persistentOffers.length
      && result.phase !== 'surgeryPlanSelection' ? current : result.persistentOffers)
    const remaining = snapshot.rerollsRemaining
    if (remaining && remaining.confidence >= .85 && Number.isInteger(remaining.value) && remaining.value >= 0 && remaining.value <= 3) {
      setRerollsRemaining(remaining.value)
    }
    setRecognitionPhase(result.phase)
    setRecognizedCandidateIds(result.confirmedCandidateIds)
    setRecognitionWarning(result.unmatchedCandidateNames.length
      ? `未匹配入库：${result.unmatchedCandidateNames.join('、')}；仅比较已识别药剂，请手动核对，未沿用旧牌推荐。`
      : result.warnings[0] ?? '')
    if (result.phase === 'potionSelection' || result.phase === 'expandedPotionSelection') {
      setAwaitingEndRound(false)
    }

    const latency = snapshot.diagnostics?.latencyMs
      ? ` · ${Math.round(snapshot.diagnostics.latencyMs)} ms`
      : ''
    const warning = result.warnings.length > 0
      ? ` · ${result.warnings[0]}`
      : ''
    const matchedCards = result.matchedPersistentCount > 0
      ? `，匹配 ${result.matchedPersistentCount} 张常驻手术用具`
      : `，匹配 ${result.matchedCandidateCount} 张候选药剂`
    setStatus(`识别完成：回填 ${result.appliedFieldCount} 个状态字段${matchedCards}${latency}${warning}`)
  }

  applyRecognitionRef.current = applyRecognition

  receiveChoicesRef.current = (tracking) => {
    setChoiceTracking(current => JSON.stringify(current) === JSON.stringify(tracking ?? null) ? current : tracking ?? null)
    if (!tracking) return
    const next = receiveChoices(choiceLog, tracking.records, persistentIds, persistentCards)
    if (next.changed) {
      setChoiceLog(next.log)
      setPersistentIds(next.ids)
    }
  }

  const confirmRecordedChoice = (record: ChoiceRecord) => {
    const card = choicePermanent(record, persistentCards)
    if (card) setPersistentIds(current => [...new Set([...current.filter(id => id !== 'none'), card.id])])
    setChoiceLog(current => current.map(r => r.id === record.id ? { ...r, status: 'manual' } : r))
    setStatus(card ? `已人工确认并追加常驻：${card.name}` : '已记录实际选择；未模拟执行药剂，怪物仍以 F8 为准')
  }

  const recognizeScreen = async () => {
    if (recognitionBusy || hotkeyBusy) return
    if (recognitionServiceOnline === false) {
      setStatus('本地识别服务未连接。请运行 .\\scripts\\start-recognition.ps1，服务启动后 F8 会自动恢复可用')
      return
    }
    setHotkeyBusy(true)
    setStatus('截图请求已发送，正在等待本地识别…')
    try {
      if (follow?.enabled) await localScreenRecognitionProvider.setFollow(false)
      await localScreenRecognitionProvider.triggerCapture()
    } catch (error) {
      setHotkeyBusy(false)
      setStatus(`截图触发失败：${error instanceof Error ? error.message : '本地服务未连接'}`)
    }
  }

  const recognizeImage = async (file: File) => {
    if (recognitionBusy || hotkeyBusy) return
    setRecognitionBusy(true)
    setStatus(`正在识别截图“${file.name}”…`)
    try {
      if (follow?.enabled) {
        followControlEpoch.current += 1
        await localScreenRecognitionProvider.setFollow(false)
      }
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

  useEffect(() => {
    let disposed = false
    let lastSequence = 0
    let lastSession: string | undefined
    let lastFollowGeneration: number | undefined
    let polling = false
    let connected = false
    let nextHealthCheckAt = 0

    const pollHotkeyRecognition = async () => {
      if (disposed || polling) return
      polling = true
      try {
        if (!connected) {
          if (Date.now() < nextHealthCheckAt) return
          const available = await localScreenRecognitionProvider.isAvailable()
          nextHealthCheckAt = Date.now() + 3_000
          if (!available) {
            if (!disposed) setRecognitionServiceOnline(false)
            return
          }
          connected = true
          if (!disposed) setRecognitionServiceOnline(true)
        }
        const requestEpoch = followControlEpoch.current
        const event = await localScreenRecognitionProvider.readHotkeyRecognition(lastSequence, lastSession)
        if (requestEpoch !== followControlEpoch.current) return
        if (event && !disposed) {
          if (lastSession !== event.sessionId) { lastSequence = 0; lastAutoSnapshot.current = '' }
          if (lastFollowGeneration !== event.follow?.generation) lastAutoSnapshot.current = ''
          lastFollowGeneration = event.follow?.generation
          lastSession = event.sessionId
          setFollow(current => JSON.stringify(current) === JSON.stringify(event.follow ?? null) ? current : event.follow ?? null)
          receiveChoicesRef.current(event.choices)
          setHotkeyReady(event.hotkeyRegistered ?? null)
          setHotkeyError(event.hotkeyError ?? null)
          setHotkeyBusy(event.status === 'recognizing')
          setCaptureReceipt(event.sequence > 0
            ? `请求 #${event.sequence} · ${event.triggerSource === 'continuous-follow' ? '自动跟随' : event.triggerSource === 'f8-hook' ? '系统 F8' : event.triggerSource === 'capture-button' ? '截图按钮' : 'F8'} · ${event.status === 'recognizing' ? '处理中' : event.status === 'failed' ? '失败' : '完成'} · ${Math.round(event.elapsedMs ?? 0)} ms`
            : '尚未收到截图请求；游戏前台按 F8')
          if (event.status === 'recognizing') {
            setStatus('F8 / 截图请求已收到，正在本机识别…')
            return
          }
          if (event.sequence <= lastSequence) return
          lastSequence = event.sequence
          if (event.snapshot) {
            const key = snapshotIdentity(event.snapshot)
            if (event.triggerSource !== 'continuous-follow' || key !== lastAutoSnapshot.current) {
              if (event.triggerSource === 'continuous-follow') lastAutoSnapshot.current = key
              applyRecognitionRef.current(event.snapshot)
            }
          }
          else if (event.error) setStatus(`快捷键识别失败：${event.error}`)
        }
      } catch {
        connected = false
        nextHealthCheckAt = Date.now() + 3_000
        if (!disposed) {
          setRecognitionServiceOnline(false)
          setHotkeyReady(false)
          setHotkeyBusy(false)
        }
      } finally {
        polling = false
      }
    }

    void pollHotkeyRecognition()
    const interval = window.setInterval(() => void pollHotkeyRecognition(), 350)
    const wake = () => { nextHealthCheckAt = 0; void pollHotkeyRecognition() }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  return (
    <div className={`app-shell ${floatingMode ? 'floating-mode' : ''}`}>
      <header className="app-bar">
        <div className="brand">
          <FlaskIcon />
          <span>渴瘾决策器</span>
          <em>桌面客户端</em>
        </div>
        <nav aria-label="牌局操作">
          <button type="button" disabled={hotkeyBusy || recognitionBusy} onClick={() => void recognizeScreen()} title="按一次 F8，截图识别一次">
            <ScanIcon /> 识别屏幕（F8）
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
          <button type="button" onClick={() => setMonsterDictionaryOpen(true)}>怪物名字典{unknownMonsterNames ? ` · ${unknownMonsterNames} 槽未收录` : ''}</button>
          <button type="button" onClick={undo} disabled={history.length === 0}>
            <UndoIcon /> 撤销
          </button>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)}>
            <SettingsIcon /> 设置
          </button>
          <button className="floating-toggle" type="button" disabled={floatingBusy} onClick={() => void toggleFloatingMode()} title="缩小并置顶显示当前推荐">
            {floatingMode ? '退出浮窗' : '开启浮窗'}
          </button>
          <span className={`recognition-indicator ${recognitionServiceOnline === true ? 'online' : 'offline'}`}>
            {recognitionServiceOnline !== true ? '识别服务未连接' : hotkeyBusy ? '正在识别…' : hotkeyReady ? 'F8 单次识别' : hotkeyError ?? '请重启新版识别服务'}
          </span>
        </nav>
      </header>

      <div className="follow-banner" role="status">
        <strong>单次识别模式</strong>
        <span>{recognitionServiceOnline === false ? '识别服务未连接，请启动新版服务' : '按一次 F8 截图一次；游戏选牌后，再按 F8 同步结果。'}</span>
        <span>点牌 → 游戏确认 → 下次 F8 校验；已知常驻自动追加，药剂仅记录、不重复结算。</span>
      </div>
      <ChoiceJournal tracking={choiceTracking} log={choiceLog} online={recognitionServiceOnline === true}
        onToggle={() => void localScreenRecognitionProvider.controlChoices(choiceTracking?.enabled ? 'disable' : 'enable').catch(error => setStatus(String(error)))}
        onConfirm={confirmRecordedChoice} onIgnore={record => {
          setChoiceLog(current => current.map(r => r.id === record.id ? { ...r, status: 'ignored' } : r))
          setStatus('已标记误记；若该条追加了常驻，请在完整界面取消对应勾选')
        }} />

      {settingsOpen && (
        <div className="settings-banner">
          <strong>当前估算假设</strong>
          <NewbornSwarmSettings value={state.newbornSwarm} onChange={(newbornSwarm) => setState(current => ({ ...current, newbornSwarm }))} />
          <span>F8 仅截图一次。选牌监听只处理当前游戏前台的左键点击，记录当前一手；刷新/药箱后重新 F8。未捕获确认（如键盘确认）时请人工核对。</span>
          <span>当前常驻组合：{persistentLoadoutName(persistentLoadout)}。手术用具按追加关系共同参与评分。</span>
          <span>重抽来自完整示例牌库、等概率、同一批不重复。真实规则录入后可替换。</span>
          <span>战略基础权重：每个有效怪物组 +6；魔法/稀有/首领分别 +8/+20/+36；常驻卡成型条件使用独立协同权重。</span>
          <span>回合结束转移：只计可确认的结构变化，每释放 1 个槽位暂记 +12；随机结果不等价时按保守下界计算。</span>
          <button type="button" onClick={() => setSettingsOpen(false)}>关闭</button>
        </div>
      )}

      {catalogOpen && <CardCatalogDialog onClose={() => setCatalogOpen(false)} />}
      {monsterDictionaryOpen && <MonsterDictionaryDialog
        entries={monsterNames.entries} loadError={monsterNames.error} snapshot={lastMonsterSnapshot}
        onSave={(entries) => setMonsterNames({ entries, error: '' })}
        onClose={() => setMonsterDictionaryOpen(false)}
      />}

      {floatingMode ? (
        <main className="floating-dashboard">
          <section className="floating-panel">
            <div className="floating-heading">
              <div>
                <span>渴瘾决策器 · 游戏浮窗</span>
                <strong>第 {state.round} 回合 · 当前活性 {totalActivity(state)}</strong>
              </div>
              <span className={`recognition-indicator ${recognitionServiceOnline === true ? 'online' : 'offline'}`}>
                {recognitionServiceOnline !== true ? '服务未连接' : hotkeyBusy ? '识别中…' : hotkeyReady ? 'F8 单次识别' : hotkeyError ?? '需重启识别服务'}
              </span>
            </div>
            {!followWaiting && <OpeningWarning state={state} offers={persistentOffers} />}
            {!followWaiting && !recognitionNeedsReview && !pendingResolution && !awaitingEndRound && !persistentOffers.length && recognitionPhase !== 'surgeryPlanSelection' &&
              <StartupAdvice compact state={state} loadout={persistentLoadout} ranking={ranking}
                cards={offeredCards.filter(card => recognizedCandidateIds === null || recognizedCandidateIds.includes(card.id))} />}
            {followWaiting ? (
              <div className="floating-recommendation"><strong>等待实时同步，暂停旧推荐</strong><p>{follow?.message}</p></div>
            ) : recognitionNeedsReview ? (
              <div className="floating-recommendation"><strong>怪物信息待核对，已暂停推荐</strong><p>{state.recognitionReview?.join('；')}</p><p>请重新识别，或展开完整界面修正并确认。</p></div>
            ) : pendingResolution || awaitingEndRound ? (
              <div className="floating-recommendation"><strong>等待结算确认</strong><p>请展开完整界面记录实际目标或结算回合；也可在游戏操作完成后按 F8 更新。</p></div>
            ) : persistentOffers.length > 0 ? (
              <PersistentRecommendation offers={persistentOffers} ranking={persistentOfferRanking} />
            ) : recognitionPhase === 'surgeryPlanSelection' ? (
              <div className="floating-recommendation"><strong>手术方案由你决定</strong><p>{state.round > 10 ? '已跳过手术方案，等待下一次药剂候选。' : '回合未超过 10，请核对阶段识别。'}</p></div>
            ) : ranking[0] ? (
              <div className="floating-recommendation">
                <span>{candidateWarning ? '可计算卡牌中的参考推荐' : '当前推荐'}</span>
                <strong>{ranking[0].card.name}</strong>
                <p>{ranking[0].card.description}</p>
                <b>{ranking[0].scoreLabel} {ranking[0].scoreDelta >= 0 ? '+' : ''}{ranking[0].scoreDelta}</b>
                <SettlementSummary result={ranking[0]} />
                <p>{ranking[0].activityRange
                  ? `预计总活性范围 ${ranking[0].activityRange.minimum}–${ranking[0].activityRange.maximum}`
                  : `选择后总活性 ${ranking[0].activityAfter}`} · {follow?.enabled ? '游戏结算后自动刷新' : '单次识别后刷新'}</p>
                {ranking[0].warnings.length > 0 && <p>{ranking[0].warnings.join('；')}</p>}
                {ranking[0].card.resolutionObservation && <p>后续随机移除或触发，请按游戏实际结果核对。</p>}
                {candidateWarning && <p>{candidateWarning}</p>}
              </div>
            ) : (
              <div className="floating-recommendation"><strong>暂不能推荐</strong><p>{candidateWarning || '未识别到可计算的候选药剂，请截图识别或手动录入。'}</p></div>
            )}
            <FloatingMonsters state={state}
              result={!followWaiting && !pendingResolution && !awaitingEndRound && !persistentOffers.length && recognitionPhase !== 'surgeryPlanSelection' ? ranking[0] : undefined}
              snapshot={recognizedMonsters === state.monsters && !recognitionNeedsReview ? lastMonsterSnapshot : null} />
            <div className="floating-actions">
              <button type="button" className="primary-button" disabled={floatingBusy} onClick={() => void toggleFloatingMode()}>
                展开完整界面
              </button>
              <button type="button" disabled={hotkeyBusy || recognitionBusy} onClick={() => void recognizeScreen()}>识别一次 / F8</button>
            </div>
            {persistentOffers.length > 0 && <div className="follow-permanent-confirm">
              <p>在游戏中选择后，点此记录实际用具（不替你点击游戏）：</p>
              {persistentOffers.map((offer,index) => <button type="button" key={`${index}-${offer.name}`} disabled={!offer.cardId}
                onClick={() => offer.cardId && choosePersistentOffer(offer.cardId)}>已选：{offer.name}</button>)}
            </div>}
            <small aria-live="polite">{captureReceipt}</small>
            <small>{status}</small>
          </section>
        </main>
      ) : (
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
          {!followWaiting && <OpeningWarning state={state} offers={persistentOffers} />}
          {followWaiting ? <section className="panel"><h2>等待实时同步，暂停旧推荐</h2><p>{follow?.message}</p></section> : recognitionNeedsReview ? (
            <section className="panel" role="alert">
              <h2>怪物信息待核对，已暂停推荐</h2>
              <p>{state.recognitionReview?.join('；')}</p>
              <p>左侧保留值仅供修正，不代表本次已识别。请核对六槽的种群、稀有度和数值，或重新截图。</p>
              <button type="button" className="primary-button" onClick={() => {
                setState((current) => ({ ...current, recognitionReview: [] }))
                setRecognitionWarning('')
                setStatus('已人工确认怪物信息，恢复推荐')
              }}>已核对怪物信息，恢复推荐</button>
            </section>
          ) : <>
          {persistentOffers.length > 0 ? (
            <section className="panel persistent-offer-workspace">
              <div className="panel-heading candidate-heading">
                <div>
                  <h1>常驻手术用具 <span>({persistentOffers.length}/3)</span></h1>
                  <p>这是追加常驻的选择，不是药剂候选；选定后会进入当前常驻组合。</p>
                </div>
              </div>
              <div className="persistent-offer-grid">
                {persistentOffers.map((offer, index) => {
                  const card = offer.cardId ? persistentCardById.get(offer.cardId) : undefined
                  const result = card ? persistentOfferResultById.get(card.id) : undefined
                  return (
                    <article className="persistent-offer-card" key={`${index}-${offer.name}`}>
                      <span>手术用具 {index + 1}</span>
                      <h2>{card?.name ?? offer.name}</h2>
                      {card ? (
                        <>
                          <p>{card.description}</p>
                          {card.modelWarning && <p>{card.modelWarning}</p>}
                          <strong>{result?.scoreDelta && result.scoreDelta > 0
                            ? `后续战略评分 +${Math.round(result.scoreDelta)}`
                            : '暂无可确认的后续收益'}</strong>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={awaitingEndRound || Boolean(pendingResolution)}
                            onClick={() => choosePersistentOffer(card.id)}
                          >
                            选择并追加
                          </button>
                        </>
                      ) : (
                        <p className="persistent-offer-unmapped">已识别“{offer.name}”，但它尚未结构化入库；请暂时在左侧手动追加，不能将其当作药剂跳过。</p>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : (
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
            <StartupAdvice state={state} loadout={persistentLoadout} ranking={ranking}
              cards={offeredCards.filter(card => recognizedCandidateIds === null || recognizedCandidateIds.includes(card.id))} />
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
                    disabled={awaitingEndRound || Boolean(follow?.enabled)}
                    following={Boolean(follow?.enabled)}
                    onCardChange={(id) => setCandidateAt(index, id)}
                    onApply={() => beginApplyCard(card.id, result?.recommendedTargetIds)}
                  />
                )
              })}
            </div>
          </section>
          )}

          {!persistentOffers.length && (coverageWarning || hasRangePreview || hasStartupPriority ? <section className="panel"><p>{coverageWarning || (hasStartupPriority ? '当前按常驻启动路线优先，不用纯活性分数自动判断洗牌；仍可手动洗牌。' : '当前含分支收益范围：不根据保守端点自动建议洗牌或药箱，仍可手动洗牌。')}</p>
            <button type="button" className="primary-button" disabled={rerollsRemaining <= 0 || Boolean(follow?.enabled)} onClick={useReroll}>{follow?.enabled ? '请在游戏中洗牌' : '手动洗牌'}（剩余 {rerollsRemaining} 次）</button>
          </section> : <RedrawStrip
            currentBest={currentBest}
            scoreLabel={ranking[0]?.scoreLabel ?? '即时活性'}
            estimate3={redraw3}
            rerollsRemaining={rerollsRemaining}
            recommended={opportunityDecision.preferRedraw}
            onReroll={useReroll}
          />)}
          </>}
        </div>

        {followWaiting ? <aside className="panel"><h2>等待稳定画面</h2><p>同步完成后自动恢复推荐，无需再按 F8。</p></aside> : recognitionNeedsReview ? (
          <aside className="panel"><h2>暂不能推荐</h2><p>先确认怪物信息，避免用旧稀有度计算常驻收益。</p></aside>
        ) : persistentOffers.length > 0 ? (
          <aside className="panel"><PersistentRecommendation offers={persistentOffers} ranking={persistentOfferRanking} /></aside>
        ) : ranking.length > 0 ? <RecommendationPanel
          ranking={ranking}
          coverageWarning={coverageWarning}
          onApply={applyRecommendation}
          disabled={awaitingEndRound || Boolean(follow?.enabled)}
          following={Boolean(follow?.enabled)}
        /> : <aside className="panel"><h2>暂不能推荐</h2><p>{recognitionPhase === 'surgeryPlanSelection' ? '手术方案由玩家自行选择。' : candidateWarning || '请识别完整候选卡或手动录入。'}</p></aside>}
      </main>
      )}

      <footer className="status-bar">
        <span><i />{status}</span>
        <span>真实卡库：84 张已载入 · {mappedRealCardCount} 张候选卡已映射 · 多常驻战略模型已启用</span>
      </footer>
    </div>
  )
}

export default App
