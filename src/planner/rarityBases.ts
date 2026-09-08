import type { RarityId } from '../types/game'
import { ModelUnavailableError, type PlannerModel } from './types'

export function freshRarityBase(model: PlannerModel, rarity: RarityId): { quantity: number; unitActivity: number } {
  const explicit = model.rarityBases?.[rarity]
  // Existing explicit fresh-monster dictionaries may supply the same fact, but
  // conflicting values must not silently become a probability distribution.
  const values = model.monsters.filter(m => m.rarity === rarity)
  const unique = new Map(values.map(m => [JSON.stringify([m.quantity, m.unitActivity]), m]))
  const base = explicit ?? (unique.size === 1 ? [...unique.values()][0] : undefined)
  if (!base || !Number.isSafeInteger(base.quantity) || base.quantity <= 0
    || !Number.isSafeInteger(base.unitActivity) || base.unitActivity <= 0)
    throw new ModelUnavailableError(`缺少或冲突的 ${rarity} 新生怪物基础数量/单体活性，请填写 rarityBases；不能复制成长属性`)
  return { quantity: base.quantity, unitActivity: base.unitActivity }
}
