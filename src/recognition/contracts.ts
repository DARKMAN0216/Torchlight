import type { GameState, RaceId, RarityId } from '../types/game'

export type RecognitionScreenPhase =
  | 'surgeryPreparation'
  | 'surgeryRewardSelection'
  | 'surgeryPlanSelection'
  | 'potionSelection'
  | 'expandedPotionSelection'
  | 'candidateSelection'
  | 'roundEndResolution'
  | 'unknown'

export interface RecognizedValue<T> {
  value: T
  confidence: number
  sourceRegion?: { x: number; y: number; width: number; height: number }
}

export interface RecognizedMonsterSlot {
  slotId: string
  occupied: RecognizedValue<boolean>
  name?: RecognizedValue<string>
  raceId?: RecognizedValue<RaceId>
  rarity?: RecognizedValue<RarityId>
  quantity?: RecognizedValue<number>
  unitActivity?: RecognizedValue<number>
  displayedTotalActivity?: RecognizedValue<number>
}

export interface RecognitionImageSource {
  width: number
  height: number
  layoutProfileId?: string
}

export interface RecognitionSnapshot {
  capturedAt: string
  phase?: RecognizedValue<RecognitionScreenPhase>
  sourceImage?: RecognitionImageSource
  round?: RecognizedValue<number>
  totalRounds?: RecognizedValue<number>
  displayedFinalActivity?: RecognizedValue<number>
  persistentCardIds?: Array<RecognizedValue<string>>
  /** @deprecated 兼容早期只支持一张常驻卡的识别实现。 */
  persistentCardId?: RecognizedValue<string>
  state?: RecognizedValue<GameState>
  monsterSlots?: RecognizedMonsterSlot[]
  candidateCardIds: Array<RecognizedValue<string>>
  candidateCardNames?: Array<RecognizedValue<string>>
}

export interface ScreenRecognitionProvider {
  readonly id: string
  readonly name: string
  isAvailable(): Promise<boolean>
  captureAndRecognize(): Promise<RecognitionSnapshot>
}

// 后续 OCR、窗口截图或桌面壳只需实现这个接口；规则引擎不依赖具体识别方案。
