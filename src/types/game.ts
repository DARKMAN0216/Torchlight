export const raceIds = ['awakened', 'aberrant', 'swarm', 'construct'] as const
export const rarityIds = ['common', 'magic', 'rare', 'boss'] as const
export const monsterSlotCount = 6

export type RaceId = (typeof raceIds)[number]
export type RarityId = (typeof rarityIds)[number]
export type DecisionMode = 'activity' | 'preserve' | 'strategic'
export type RaceSelector = RaceId | 'all' | 'dominant' | 'lowestActivity' | 'lowestQuantity' | 'selected'

export interface CardTargeting {
  mode: 'choose' | 'observedRandom'
  minTargets: number
  maxTargets: number
  prompt: string
  excludeBoss?: boolean
  allowedRarities?: RarityId[]
  requireSameRarity?: boolean
  maxPerRarity?: number
  requireEachEligibleRarity?: boolean
  observedRaces?:
    | {
        mode: 'perTarget'
        prompt: string
      }
    | {
        mode: 'newGroups'
        count: number
        prompt: string
      }
}

export interface EvaluationContext {
  selectedMonsterIds?: string[]
  observedRaceByMonsterId?: Partial<Record<string, RaceId>>
  observedNewGroupRaces?: RaceId[]
  observedRemovedMonsterIds?: string[]
  observedPersistentTriggerTargetIds?: string[]
  observedPersistentTriggerTargetIdsByCardId?: Partial<Record<string, string[]>>
  observedAddedGroupMutationIdsByCardId?: Partial<Record<string, string[]>>
}

export interface ResolutionObservation {
  removals?: {
    count: number
    prompt: string
    differentRaceFromPrimaryTarget?: boolean
    allowFewerWhenUnavailable?: boolean
  }
}

export interface MonsterGroup {
  id: string
  race: RaceId | null
  rarity: RarityId
  quantity: number
  unitActivity: number
}

export interface GameState {
  /** User-confirmed base stats for an added swarm; never inferred from old monsters. */
  newbornSwarm?: { quantity: number; unitActivity: number; rarity: RarityId }
  round: number
  mode: DecisionMode
  monsters: MonsterGroup[]
  /** OCR uncertainty retained with saved state until a new reliable scan or manual review. */
  recognitionReview?: string[]
}

export type Condition =
  | { type: 'minQuantity'; target: RaceId; value: number }
  | { type: 'minActivity'; target: RaceId; value: number }
  | { type: 'minRaceGroups'; target: RaceId; value: number }
  | { type: 'minRarityGroups'; rarity: RarityId; value: number }
  | { type: 'minRaceRarityGroups'; target: RaceId; rarities: RarityId[]; value: number }
  | { type: 'singleRace' }

export type CardEffect =
  | { type: 'withTargets'; ids: string[]; effects: CardEffect[]; condition?: Condition }
  | { type: 'removeRightOfSelected'; condition?: Condition }
  | {
      type: 'addActivity'
      target: RaceSelector
      amount: number
      perUnit?: boolean
      allMatches?: boolean
      repeatByRarity?: Partial<Record<RarityId, number>>
      repeatOnlyRace?: RaceId
      repeatPerRaceGroup?: RaceId
      minQuantityExclusive?: number
      condition?: Condition
    }
  | {
      type: 'addQuantity'
      target: RaceSelector
      amount: number
      activityPerNewUnit?: number
      allMatches?: boolean
      condition?: Condition
    }
  | {
      type: 'multiplyActivity'
      target: RaceSelector
      factor: number
      condition?: Condition
    }
  | {
      type: 'removeRace'
      target: RaceSelector
      transferTo?: RaceSelector
      transferRate?: number
      condition?: Condition
    }
  | {
      type: 'removeObservedGroups'
      count: number
      differentRaceFromSelected?: boolean
      allowFewerWhenUnavailable?: boolean
      condition?: Condition
    }
  | {
      type: 'removeLeftOfSelected'
      condition?: Condition
    }
  | {
      type: 'convertRace'
      target: RaceSelector
      to: RaceId | 'observed'
      bonusPerUnit?: number
      onlyIfDifferent?: boolean
      allMatches?: boolean
      condition?: Condition
    }
  | {
      type: 'upgradeRarity'
      target: RaceSelector
      steps: number
      allMatches?: boolean
      condition?: Condition
    }
  | {
      type: 'setRarity'
      target: RaceSelector
      rarity: RarityId
      allMatches?: boolean
      onlyRace?: RaceId
      allowDowngrade?: boolean
      activityBonusOnChange?: number
      condition?: Condition
    }
  | {
      type: 'mergeSelected'
      minTargets?: 1 | 2
      upgradeSteps?: number
      rarity?: RarityId
      outputRace?: RaceId
      requireSameRarity?: boolean
      condition?: Condition
    }
  | {
      type: 'addObservedGroups'
      rarity: RarityId
      quantity: number
      activity?: number
      condition?: Condition
    }
  | {
      type: 'addGroup'
      base?: GameState['newbornSwarm']
      race: RaceId
      rarity?: RarityId
      quantity?: number
      activity?: number
      count?: number
      condition?: Condition
    }

export interface RoundEndEffect {
  description: string
  effects: CardEffect[]
  targeting?: CardTargeting
  everyRounds?: number
  repeatWhileEligible?: boolean
}

export type StrategicRule =
  | {
      type: 'raceAnchor'
      race: RaceId
      activityMultiplier: number
      label: string
    }
  | {
      type: 'groupThreshold'
      race?: RaceId
      rarity?: RarityId
      rarities?: RarityId[]
      targetCount: number
      progressValue: number
      completionBonus: number
      label: string
    }
  | {
      type: 'largestRaritySet'
      targetCount: number
      progressValue: number
      completionBonus: number
      excludeBoss?: boolean
      label: string
    }
  | {
      type: 'singleRace'
      completionBonus: number
      penaltyPerExtraRace: number
      label: string
    }
  | {
      type: 'upgradableRarityCoverage'
      valuePerRarity: number
      label: string
    }

export interface StrategicProfile {
  summary: string
  rules: StrategicRule[]
}

export interface CandidateCard {
  /** Multi-outcome preview only; actual outcomes must be imported from the game. */
  projection?: 'cleansing' | 'leechRace' | 'leechRarity' | 'freshSpinal' | 'birthBone' | 'graySpinal' | 'aberrantAnesthetic' | 'hollowSpinal' | 'lowestBoost' | 'boneOil' | 'peat' | 'compound' | 'seriesMutation' | 'seriesRemoval' | 'egg' | 'exorcise' | 'randomRareMutation' | 'randomMagicMutation'
  /** Card-text-only route information; does NOT supply missing new-monster stats. */
  randomReplacementCount?: number
  requiresNewbornSwarm?: boolean
  excludeFromRedraw?: boolean
  requiresScreenSync?: boolean
  id: string
  name: string
  rarity: 1 | 2 | 3
  description: string
  tags: string[]
  effects: CardEffect[]
  targeting?: CardTargeting
  resolutionObservation?: ResolutionObservation
  rankObservedRandom?: 'conservative'
  followUpOfferCount?: 3 | 5
  modelCoverage?: 'confirmed' | 'partial' | 'unresolved'
  modelWarning?: string
  /** Known card text, but no trustworthy numeric evaluation is available yet. */
  evaluationUnavailable?: boolean
}

export interface PersistentCard {
  modelWarning?: string
  /** Preview only: repetition wording has two possible interpretations. */
  roundEndQuantityPerRaceGroup?: { race: RaceId; amount: number }
  id: string
  name: string
  /** OCR 常见误读或旧译名；用于识别层回填，不影响界面显示名。 */
  aliases?: string[]
  description: string
  globalGainMultiplier?: number
  targetGainMultiplier?: Partial<Record<RaceId, number>>
  singleRaceFinalMultiplier?: number
  conversionBonusPerUnit?: Partial<Record<RaceId, number>>
  roundEndEffect?: RoundEndEffect
  strategicProfile?: StrategicProfile
  onRemovalQuantityBonus?: {
    excludedRace?: RaceId
    amount: number
    target: 'observedRandom'
    condition?: Condition
  }
  onAddGroupExpectedMutation?: {
    probability: number
    toRace: RaceId
    unitActivityBonus: number
  }
  onMutationActivityBonus?: {
    toRace?: RaceId
    amount: number
    condition?: Condition
  }
}

export type PersistentLoadout = PersistentCard | readonly PersistentCard[]

export interface EvaluationResult {
  /** Final race counts across branches; bounds, NOT probabilities. */
  raceGroupRange?: Partial<Record<RaceId, { minimum: number; maximum: number }>>
  startup?: {
    race: RaceId
    passiveNames: string[]
    minimumGroups: number
    maximumGroups: number
    safeForPriority: boolean
  }
  /** Preview only. Never applied to the observed/immediate board. */
  settlement?: {
    uncertain: boolean
    beforeBonus: number
    afterBonus: number
    change: number
    projectedActivity: number
    details: string[]
  }
  activityRange?: { minimum: number; maximum: number }
  card: CandidateCard
  state: GameState
  activityBefore: number
  activityAfter: number
  delta: number
  score: number
  scoreDelta: number
  scoreLabel: string
  analysis: string[]
  recommendedTargetIds?: string[]
  trace: string[]
  warnings: string[]
}

export interface RedrawEstimate {
  drawCount: number
  expectedBest: number
  expectedDelta: number
  improveProbability: number
  minimumBest: number
  maximumBest: number
  sampleCount: number
}
