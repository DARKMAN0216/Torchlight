import { raceIds, rarityIds, type GameState } from '../types/game'

export function parsePersistentModel(text: string): NonNullable<GameState['persistentModel']> {
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型数据必须是 JSON 对象')
  const model: NonNullable<GameState['persistentModel']> = {}
  const positive = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
  if (value.specialBases !== undefined) {
    const special = value.specialBases
    if (!special || typeof special !== 'object' || Array.isArray(special)
      || Object.keys(special).some(key => key !== 'hollowCocoon')) throw new Error('专属基础值仅支持 hollowCocoon')
    model.specialBases = {}
    if (special.hollowCocoon !== undefined) {
      const base = special.hollowCocoon
      if (!base || !positive(base.quantity) || !positive(base.unitActivity)) throw new Error('空心茧基础值必须是正整数')
      model.specialBases.hollowCocoon = { quantity: base.quantity, unitActivity: base.unitActivity }
    }
  }
  if (value.rarityBases !== undefined) {
    if (!value.rarityBases || typeof value.rarityBases !== 'object' || Array.isArray(value.rarityBases))
      throw new Error('稀有度基础值必须是对象')
    model.rarityBases = {}
    for (const [rarity, raw] of Object.entries(value.rarityBases)) {
      const base = raw as { quantity?: unknown; unitActivity?: unknown } | null
      if (!rarityIds.includes(rarity as never) || !base || !positive(base.quantity) || !positive(base.unitActivity))
        throw new Error('稀有度基础数量和单体活性必须为正整数')
      model.rarityBases[rarity as typeof rarityIds[number]] = { quantity: base.quantity as number, unitActivity: base.unitActivity as number }
    }
  }
  if (value.monsters !== undefined) {
    if (!Array.isArray(value.monsters) || value.monsters.length > 2000) throw new Error('怪物字典最多2000条')
    const ids = new Set<string>()
    model.monsters = value.monsters.map((m: Record<string, unknown>) => {
      if (!m || typeof m.monsterId !== 'string' || !m.monsterId || ids.has(m.monsterId)
        || !raceIds.includes(m.race as never) || !rarityIds.includes(m.rarity as never)
        || !positive(m.quantity) || !positive(m.unitActivity)) throw new Error('怪物ID、种群、稀有度或基础数值无效')
      ids.add(m.monsterId)
      return { monsterId: m.monsterId, race: m.race as typeof raceIds[number], rarity: m.rarity as typeof rarityIds[number],
        quantity: m.quantity as number, unitActivity: m.unitActivity as number }
    })
  }
  if (value.rarityPriors !== undefined) {
    if (!value.rarityPriors || typeof value.rarityPriors !== 'object' || Array.isArray(value.rarityPriors)) throw new Error('稀有度先验格式无效')
    model.rarityPriors = {}
    for (const [key, entries] of Object.entries(value.rarityPriors)) {
      if (!rarityIds.includes(key as never) || !Array.isArray(entries) || entries.length > 2000
        || entries.some(p => !p || !positive(p.quantity) || !positive(p.unitActivity))) throw new Error('稀有度先验必须包含合法正整数属性')
      model.rarityPriors[key as typeof rarityIds[number]] = entries.map(p => ({ quantity: p.quantity, unitActivity: p.unitActivity }))
    }
  }
  if (value.raritySamples !== undefined) {
    if (!Array.isArray(value.raritySamples) || value.raritySamples.length > 10000) throw new Error('转换样本最多10000条')
    const ids = new Set<string>()
    model.raritySamples = value.raritySamples.map((s: Record<string, unknown>) => {
      if (!s || ['id','cardId','beforeMonsterId','afterMonsterId'].some(k => typeof s[k] !== 'string' || !s[k])
        || ids.has(s.id as string) || !rarityIds.includes(s.fromRarity as never) || !rarityIds.includes(s.toRarity as never)
        || ['beforeQuantity','afterQuantity','beforeUnitActivity','afterUnitActivity'].some(k => !positive(s[k])))
        throw new Error('转换样本ID、稀有度或前后数值无效')
      ids.add(s.id as string)
      return s as unknown as NonNullable<NonNullable<GameState['persistentModel']>['raritySamples']>[number]
    })
  }
  if (value.pupaRepetitions !== undefined) {
    if (!['totalX', 'additionalX'].includes(value.pupaRepetitions)) throw new Error('人蛹重复规则无效')
    model.pupaRepetitions = value.pupaRepetitions
  }
  if (value.persistentOrder !== undefined) {
    if (!['acquisition', 'reverse', 'random'].includes(value.persistentOrder)) throw new Error('常驻顺序配置无效')
    model.persistentOrder = value.persistentOrder
  }
  return model
}
