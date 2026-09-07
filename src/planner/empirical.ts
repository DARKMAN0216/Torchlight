import { ModelUnavailableError, type Monster, type PlannerModel } from './types'
import type { RarityId } from '../types/game'
import { pick, type Random } from './random'

export function sampleRarityStats(
  before: Monster, toRarity: RarityId, cardId: string, afterMonsterId: string | undefined,
  model: PlannerModel, random: Random,
): { quantity: number; unitActivity: number; warning: string } {
  const samples = model.raritySamples.filter(s => s.fromRarity === before.rarity && s.toRarity === toRarity)
  const levels = [
    samples.filter(s => s.cardId === cardId && s.beforeMonsterId === before.monsterId
      && afterMonsterId !== undefined && s.afterMonsterId === afterMonsterId),
    samples.filter(s => s.cardId === cardId),
    samples,
  ]
  const level = levels.findIndex(s => s.length > 0)
  if (level >= 0) {
    const s = pick(levels[level], random)
    // Explicit temporary transfer model: preserve accumulated growth using observed integer deltas.
    const quantity = before.quantity + s.afterQuantity - s.beforeQuantity
    const unitActivity = before.unitActivity + s.afterUnitActivity - s.beforeUnitActivity
    if (quantity <= 0 || unitActivity <= 0) throw new ModelUnavailableError('稀有度样本差值迁移产生非正数，需要对应局面的样本')
    return { quantity, unitActivity, warning: `稀有度经验层级${level + 1}，${levels[level].length}条；差值迁移是假设，低置信度` }
  }
  const priors = model.rarityPriors[toRarity] ?? model.monsters.filter(m => m.rarity === toRarity)
  if (!priors.length) throw new ModelUnavailableError(`缺少 ${before.rarity}→${toRarity} 变异样本或显式先验`)
  const stats = pick(priors, random)
  return { quantity: stats.quantity, unitActivity: stats.unitActivity,
    warning: '使用目标稀有度总体经验分布替换数值，低置信度；并非实测转换规则' }
}
