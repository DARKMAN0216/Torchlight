import type {
  GameState,
  MonsterGroup,
  PersistentLoadout,
  RarityId,
  StrategicRule,
} from '../types/game'
import { persistentCardsIn } from './persistent'

const occupiedGroupValue = 6
const rarityPotential: Record<RarityId, number> = {
  common: 0,
  magic: 8,
  rare: 20,
  boss: 36,
}

export interface StrategicEvaluation {
  value: number
  baseValue: number
  ruleValue: number
  groupCount: number
  analysis: string[]
}

interface StrategicRuleEvaluation {
  value: number
  analysis: string[]
}

function activeGroups(state: GameState): MonsterGroup[] {
  return state.monsters.filter((monster) => monster.race !== null)
}

function evaluateRule(groups: MonsterGroup[], rule: StrategicRule): StrategicRuleEvaluation {
  if (rule.type === 'raceAnchor') {
    const anchorActivity = groups
      .filter((group) => group.race === rule.race)
      .reduce((sum, group) => sum + group.quantity * group.unitActivity, 0)
    const value = Math.round(anchorActivity * rule.activityMultiplier)
    return {
      value,
      analysis: [
        `${rule.label}：路线核心活性 ${anchorActivity} × ${rule.activityMultiplier}，协同 +${value}`,
      ],
    }
  }

  if (rule.type === 'groupThreshold') {
    const count = groups.filter((group) =>
      (!rule.race || group.race === rule.race) &&
      (!rule.rarity || group.rarity === rule.rarity),
    ).length
    const progress = Math.min(count, rule.targetCount) * rule.progressValue
    const completion = count >= rule.targetCount ? rule.completionBonus : 0
    const value = progress + completion
    return {
      value,
      analysis: [`${rule.label}：${count}/${rule.targetCount} 组，协同 ${value >= 0 ? '+' : ''}${value}`],
    }
  }

  if (rule.type === 'largestRaritySet') {
    const counts = new Map<RarityId, number>()
    for (const group of groups) {
      if (rule.excludeBoss && group.rarity === 'boss') continue
      counts.set(group.rarity, (counts.get(group.rarity) ?? 0) + 1)
    }
    let largest = 0
    for (const count of counts.values()) largest = Math.max(largest, count)
    const progress = Math.min(largest, rule.targetCount) * rule.progressValue
    const completion = largest >= rule.targetCount ? rule.completionBonus : 0
    const value = progress + completion
    return {
      value,
      analysis: [`${rule.label}：最大同稀有度组 ${largest}/${rule.targetCount}，协同 +${value}`],
    }
  }

  if (rule.type === 'singleRace') {
    const raceCount = new Set(groups.map((group) => group.race)).size
    const value = raceCount <= 1
      ? rule.completionBonus
      : -(raceCount - 1) * rule.penaltyPerExtraRace
    return {
      value,
      analysis: [`${rule.label}：当前 ${raceCount} 个种群，协同 ${value >= 0 ? '+' : ''}${value}`],
    }
  }

  const covered = new Set(
    groups
      .filter((group) => group.rarity !== 'boss')
      .map((group) => group.rarity),
  ).size
  const value = covered * rule.valuePerRarity
  return {
    value,
    analysis: [`${rule.label}：覆盖 ${covered} 种可升阶稀有度，协同 +${value}`],
  }
}

export function evaluateStrategicState(
  state: GameState,
  persistent: PersistentLoadout,
): StrategicEvaluation {
  const persistentCards = persistentCardsIn(persistent)
  const groups = activeGroups(state)
  const activity = groups.reduce(
    (sum, group) => sum + group.quantity * group.unitActivity,
    0,
  )
  const formationValue = groups.length * occupiedGroupValue
  const rarityValue = groups.reduce(
    (sum, group) => sum + rarityPotential[group.rarity],
    0,
  )
  const ruleResults = persistentCards.flatMap((card) =>
    card.strategicProfile?.rules.map((rule) => evaluateRule(groups, rule)) ?? [],
  )
  const ruleValue = ruleResults.reduce((sum, result) => sum + result.value, 0)

  return {
    value: activity + formationValue + rarityValue + ruleValue,
    baseValue: activity + formationValue + rarityValue,
    ruleValue,
    groupCount: groups.length,
    analysis: [
      `基础活性 ${activity}`,
      `阵容完整度：${groups.length} 组，+${formationValue}`,
      `稀有度潜力：+${rarityValue}`,
      ...(persistentCards.some((card) => card.strategicProfile)
        ? persistentCards.flatMap((card) => card.strategicProfile
            ? [`${card.name}方向：${card.strategicProfile.summary}`]
            : [])
        : ['当前常驻卡暂无专属协同规则']),
      ...ruleResults.flatMap((result) => result.analysis),
    ],
  }
}
