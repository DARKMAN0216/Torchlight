import type { RecognizedMonsterSlot } from './contracts'

export interface RecognitionConsistency {
  calculatedFinalActivity?: number
  displayedFinalActivity?: number
  matchesDisplayedTotal?: boolean
  issues: string[]
}

export function calculateDisplayedGroupActivity(
  quantity: number,
  unitActivity: number,
): number {
  return quantity * unitActivity
}

export function validateRecognitionConsistency(
  slots: RecognizedMonsterSlot[],
  displayedFinalActivity?: number,
): RecognitionConsistency {
  const issues: string[] = []
  let calculatedFinalActivity = 0
  let complete = true

  for (const slot of slots) {
    if (!slot.occupied.value) continue
    if (!slot.quantity || !slot.unitActivity) {
      complete = false
      issues.push(`${slot.slotId} 缺少数量或单体活性，无法校验该组总活性`)
      continue
    }
    const calculated = calculateDisplayedGroupActivity(
      slot.quantity.value,
      slot.unitActivity.value,
    )
    calculatedFinalActivity += calculated
    if (
      slot.displayedTotalActivity &&
      slot.displayedTotalActivity.value !== calculated
    ) {
      issues.push(
        `${slot.slotId} 显示总活性 ${slot.displayedTotalActivity.value}，` +
          `但数量 × 单体活性为 ${calculated}`,
      )
    }
  }

  if (
    complete &&
    displayedFinalActivity !== undefined &&
    calculatedFinalActivity !== displayedFinalActivity
  ) {
    issues.push(
      `各组计算总活性 ${calculatedFinalActivity} 与界面最终活性 ${displayedFinalActivity} 不一致`,
    )
  }

  return {
    calculatedFinalActivity: complete ? calculatedFinalActivity : undefined,
    displayedFinalActivity,
    matchesDisplayedTotal: complete && displayedFinalActivity !== undefined
      ? calculatedFinalActivity === displayedFinalActivity
      : undefined,
    issues,
  }
}
