import type { RaceId, RarityId } from '../types/game'

export interface Monster {
  monsterId: string
  instanceId: string
  race: RaceId
  rarity: RarityId
  quantity: number
  unitActivity: number
}
export interface Slot { slotId: string; monster: Monster | null }
export interface PersistentRuntimeState {
  cardId: string
  acquiredRound: number
  firstEligibleRound: number
  triggerCount: number
  enabled: boolean
}
export interface PlannerState {
  round: number
  totalRounds: 13
  decisionRounds: 10
  maxGroups: 6
  slots: Slot[]
  persistentEffects: PersistentRuntimeState[]
  offeredCardIds: string[]
  redrawsRemaining: number
  specialPotionStage: number
  /** Special candidates for this offer only; another choice ends the chain. */
  specialOffer?: SpecialOffer
  nextInstanceId: number
  recognitionReview: string[]
}
export type GameAction =
  | { type: 'playCard'; cardId: string; selectedSlotIds: string[] }
  | { type: 'redraw' }
  | { type: 'advanceSurgeryPlanRound' }
export type EventType = 'cardPlayed' | 'removeSucceeded' | 'addAttempted'
  | 'addSucceeded' | 'addFailedBoardFull' | 'mutationCompleted' | 'fusionCompleted' | 'roundEnd'
export interface GameEvent {
  type: EventType
  source: string
  round: number
  slotId?: string
  before?: Monster
  after?: Monster
}
export interface Filter {
  race?: RaceId
  excludeRace?: RaceId
  rarities?: RarityId[]
  minQuantityExclusive?: number
  minActivityExclusive?: number
}
export interface TargetRule {
  mode: 'choose' | 'random'
  min: number
  max: number
  filter?: Filter
  sameRarity?: boolean
}
export type Selector =
  | { mode: 'selected' }
  | { mode: 'eventMonster' }
  | { mode: 'all' | 'random' | 'highest' | 'lowest'; filter?: Filter }
export interface Condition { filter: Filter; minGroups: number; maxGroups?: number; all?: Condition[] }
export type MonsterBase = Omit<Monster, 'instanceId'>
export interface GenerationSpec {
  filter?: Filter
  base?: MonsterBase
  quantityBonus?: number
  activityBonus?: number
}
export type Effect = (
  | { type: 'specialPotion'; kind: 'cocoon' | 'copy1' | 'copy2' | 'copy3' | 'mother' | 'communion' | 'disease' | 'skeleton' }
  | { type: 'confirmedPotion'; kind: 'twinSwarm' | 'eggshell' | 'viscousBile' | 'swarmFusion' | 'xeno' | 'insectLure' | 'oviposition' }
  | { type: 'stats'; target: Selector; quantity?: number; activity?: number; activityFactor?: number
      repeatPerRace?: RaceId; awakenedRarityRepeat?: boolean }
  | { type: 'remove'; target: Selector }
  | { type: 'removeNeighbor'; offset: -1 | 1 }
  | { type: 'add'; count: number; spec: GenerationSpec }
  | { type: 'mutate'; target: Selector; race?: RaceId | 'random'; rarity?: RarityId; upgradeSteps?: number
      onlyIfDifferentRace?: boolean; activityBonus?: number; randomIdentity?: boolean }
  | { type: 'fuse'; race: RaceId; rarity?: RarityId }
  | { type: 'chance'; probability: number; effects: Effect[] }
  | { type: 'ifSelected'; filter: Filter; effects: Effect[] }
  | { type: 'pupaGrowth' }
  | { type: 'fuseMatching'; count: 2 | 3; filter: Filter; sameRarity?: boolean; race?: RaceId; rarity?: RarityId; upgradeSteps?: number; repeat?: boolean }
  | { type: 'devour'; victim: Selector; recipient: Selector }
  | { type: 'upgradeEachRarity' }
  | { type: 'randomizeAll' }
) & { condition?: Condition }
export interface CardDefinition {
  id: string
  name: string
  targeting?: TargetRule
  effects: Effect[]
  eligibility?: { minRound?: number; maxRound?: number; stage?: number; condition?: Condition }
  nextStage?: number
  specialOffer?: SpecialOffer
  acquirePersistentId?: string
  unsupportedReason?: string
}
export interface SpecialOffer {
  mode: 'additional' | 'replace'
  count: number
  poolId: string
  /** Qualitative observation, never a numeric probability. */
  likelyCardName?: string
}
export interface PersistentDefinition {
  id: string
  name: string
  triggers: Array<{
    event: EventType
    effects: Effect[]
    condition?: Condition
    eventRace?: RaceId
    excludedEventRace?: RaceId
    everyRounds?: number
  }>
  unsupportedReason?: string
}
export interface RarityTransitionSample {
  id: string
  cardId: string
  beforeMonsterId: string
  afterMonsterId: string
  fromRarity: RarityId
  toRarity: RarityId
  beforeQuantity: number
  afterQuantity: number
  beforeUnitActivity: number
  afterUnitActivity: number
}
export interface PlannerModel {
  /** Special identities never borrow ordinary boss bases. */
  specialBases?: { hollowCocoon?: { quantity: number; unitActivity: number } }
  /** Explicit scenario weights, not inferred from high probability. */
  specialOfferPools?: Record<string, Array<{ cardId: string; weight: number }>>
  /** User-confirmed fresh-spawn stats by rarity; NOT empirical mutation priors. */
  rarityBases?: Partial<Record<RarityId, { quantity: number; unitActivity: number }>>
  version: string
  cards: CardDefinition[]
  persistent: PersistentDefinition[]
  /** Explicit pool: a restricted pool must be labelled as a scenario. */
  offerPool: string[]
  offerCount: number
  offersWithReplacement: boolean
  poolLabel: string
  monsters: MonsterBase[]
  raritySamples: RarityTransitionSample[]
  /** Optional explicit priors. Missing data throws; never implicitly preserves stats. */
  rarityPriors: Partial<Record<RarityId, Array<{ quantity: number; unitActivity: number }>>>
  persistentOrder: 'acquisition' | 'reverse' | 'random'
  assumptions: string[]
  maxEvents: number
  /** Card wording ambiguity is explicit and versioned, never inferred from one outcome. */
  pupaRepetitions?: 'totalX' | 'additionalX'
}
export interface SimulationResult {
  state: PlannerState
  events: GameEvent[]
  warnings: string[]
}
export interface PassiveObservations {
  targetSlotIds?: Partial<Record<string, string[]>>
  mutatedAdditionSlotIds?: Partial<Record<string, string[]>>
}
export class ModelUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelUnavailableError' }
}
