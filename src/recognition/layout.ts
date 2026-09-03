import type { RecognitionScreenPhase } from './contracts'

export interface NormalizedRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface MonsterSlotRegions {
  specimen: NormalizedRegion
  summary: NormalizedRegion
}

export interface ScreenshotLayoutProfile {
  id: string
  phase: RecognitionScreenPhase
  referenceSize: { width: number; height: number }
  stageTitle: NormalizedRegion
  roundCounter: NormalizedRegion
  finalActivity: NormalizedRegion
  monsterSlots: MonsterSlotRegions[]
  candidateCards: NormalizedRegion[]
}

const region = (
  x: number,
  y: number,
  width: number,
  height: number,
): NormalizedRegion => ({ x, y, width, height })

export const surgeryPreparation1920: ScreenshotLayoutProfile = {
  id: 'surgery-preparation-1920x1080-v1',
  phase: 'surgeryPreparation',
  referenceSize: { width: 1920, height: 1080 },
  stageTitle: region(0.038, 0.008, 0.09, 0.062),
  roundCounter: region(0.041, 0.348, 0.068, 0.065),
  finalActivity: region(0.039, 0.439, 0.073, 0.041),
  monsterSlots: [
    { specimen: region(0.164, 0.052, 0.116, 0.304), summary: region(0.165, 0.348, 0.112, 0.061) },
    { specimen: region(0.300, 0.052, 0.116, 0.304), summary: region(0.301, 0.348, 0.112, 0.061) },
    { specimen: region(0.437, 0.052, 0.116, 0.304), summary: region(0.438, 0.348, 0.112, 0.061) },
    { specimen: region(0.573, 0.052, 0.116, 0.304), summary: region(0.574, 0.348, 0.112, 0.061) },
    { specimen: region(0.710, 0.052, 0.116, 0.304), summary: region(0.711, 0.348, 0.112, 0.061) },
    { specimen: region(0.846, 0.052, 0.116, 0.304), summary: region(0.847, 0.348, 0.112, 0.061) },
  ],
  candidateCards: [
    region(0.407, 0.665, 0.119, 0.267),
    region(0.495, 0.651, 0.119, 0.267),
    region(0.579, 0.638, 0.119, 0.267),
  ],
}

export const potionSelection1920: ScreenshotLayoutProfile = {
  ...surgeryPreparation1920,
  id: 'potion-selection-1920x1080-v1',
  phase: 'potionSelection',
}

export const surgeryRewardSelection1920: ScreenshotLayoutProfile = {
  ...surgeryPreparation1920,
  id: 'surgery-reward-selection-1920x1080-v1',
  phase: 'surgeryRewardSelection',
}

export const expandedPotionSelection1920: ScreenshotLayoutProfile = {
  ...surgeryPreparation1920,
  id: 'expanded-potion-selection-1920x1080-v1',
  phase: 'expandedPotionSelection',
  candidateCards: [
    region(0.303, 0.681, 0.103, 0.252),
    region(0.389, 0.670, 0.104, 0.255),
    region(0.474, 0.659, 0.104, 0.255),
    region(0.559, 0.670, 0.104, 0.255),
    region(0.643, 0.681, 0.104, 0.252),
  ],
}

export function toPixelRegion(
  normalized: NormalizedRegion,
  imageWidth: number,
  imageHeight: number,
): PixelRegion {
  return {
    x: Math.round(normalized.x * imageWidth),
    y: Math.round(normalized.y * imageHeight),
    width: Math.round(normalized.width * imageWidth),
    height: Math.round(normalized.height * imageHeight),
  }
}
