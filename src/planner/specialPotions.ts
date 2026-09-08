import { rarityIds } from '../types/game'
import { pick, type Random } from './random'
import { freshRarityBase } from './rarityBases'
import { ModelUnavailableError, type CardDefinition, type Effect, type GameEvent, type GenerationSpec,
  type PlannerModel, type PlannerState, type Slot } from './types'

export const cocoonId = 'special:hollow-cocoon'
const swarmId = (index: number) => `catalog-特殊药剂:蛊虫特殊药剂:${index}`
export const specialPotions: CardDefinition[] = [
  { id: swarmId(1), name: '孵化灵药：空心茧', effects: [{ type: 'specialPotion', kind: 'cocoon' }],
    specialOffer: { mode: 'additional', count: 2, poolId: 'swarm-generation-1', likelyCardName: '子一代：爬虫卵簇' } },
  { id: swarmId(3), name: '子一代：爬虫卵簇', effects: [{ type: 'specialPotion', kind: 'copy1' }],
    specialOffer: { mode: 'additional', count: 2, poolId: 'swarm-generation-2', likelyCardName: '子二代：爬虫蛹簇' } },
  { id: swarmId(5), name: '子二代：爬虫蛹簇', effects: [{ type: 'specialPotion', kind: 'copy2' }],
    specialOffer: { mode: 'additional', count: 2, poolId: 'swarm-generation-3' } },
  { id: swarmId(7), name: '子三代：破茧蝶群', effects: [{ type: 'specialPotion', kind: 'copy3' }],
    specialOffer: { mode: 'additional', count: 1, poolId: 'swarm-mother', likelyCardName: '孵化灵药：空心虫母' } },
  { id: swarmId(8), name: '孵化灵药：空心虫母', effects: [{ type: 'specialPotion', kind: 'mother' }] },
  { id: 'catalog-特殊药剂:觉醒者特殊药剂:4', name: '第四仪式圣水：圣餐', effects: [{ type: 'specialPotion', kind: 'communion' }] },
  { id: 'catalog-特殊药剂:骨卫兵特殊药剂:1', name: '解剖浸液：病躯', effects: [{ type: 'specialPotion', kind: 'disease' }],
    specialOffer: { mode: 'additional', count: 1, poolId: 'construct-dissection-1' } },
  { id: 'catalog-特殊药剂:骨卫兵特殊药剂:5', name: '解剖浸液：完整骨架', effects: [{ type: 'specialPotion', kind: 'skeleton' }] },
]

interface Context {
  state: PlannerState
  model: PlannerModel
  random: Random
  source: string
  add: (spec: GenerationSpec, source: string) => Slot | undefined
  remove: (slot: Slot, source: string) => void
  emit: (event: Omit<GameEvent, 'round'>) => void
  warn: (message: string) => void
}

/** Card effects finish before FIFO passive settlement; no draw or real-state write. */
export function applySpecialPotion(kind: Extract<Effect, { type: 'specialPotion' }>['kind'], ctx: Context): void {
  const { state, model, random, source, add, remove, emit, warn } = ctx
  const occupied = () => state.slots.filter(s => s.monster)
  const free = () => state.slots.some(s => !s.monster)
  const freshConstruct = (rarity?: typeof rarityIds[number]) => {
    if (!free()) { add({}, source); return }
    if (!rarity) rarityIds.forEach(r => freshRarityBase(model, r))
    const r = rarity ?? pick(rarityIds, random)
    add({ base: { monsterId: `class:construct:${r}`, race: 'construct', rarity: r, ...freshRarityBase(model, r) } }, source)
  }
  switch (kind) {
    case 'cocoon': {
      // A failed obtain does not cancel the independent next-offer effect.
      if (!free()) { add({}, source); break }
      const base = model.specialBases?.hollowCocoon
      if (!base || !Number.isSafeInteger(base.quantity) || base.quantity <= 0
        || !Number.isSafeInteger(base.unitActivity) || base.unitActivity <= 0)
        throw new ModelUnavailableError('空心茧专属基础数量/活性未知：请提供 specialBases.hollowCocoon，不能套用普通蛊虫首领数值')
      add({ base: { monsterId: cocoonId, race: 'swarm', rarity: 'boss', ...base } }, source)
      break
    }
    case 'copy1': case 'copy2': case 'copy3': {
      const swarms = occupied().filter(s => s.monster!.race === 'swarm')
      if (!swarms.length) { warn('没有可复制蛊虫；即时复制不生效，后续额外发牌独立保留'); break }
      const target = pick(swarms, random)
      const { instanceId: _instance, ...snapshot } = target.monster!
      const bonus = { copy1: 10, copy2: 20, copy3: 30 }[kind]
      // Copy immediately BEFORE this card's growth, not fresh-spawn stats.
      const copy = add({ base: snapshot }, source)
      target.monster!.quantity += bonus
      if (copy) copy.monster!.quantity += bonus
      warn('复制本次成长前的当前属性（不重置为新生基础值）；复制后两组加数量，满槽仅原组加数量')
      break
    }
    case 'mother': {
      const all = occupied()
      const cocoons = all.filter(s => s.monster!.monsterId === cocoonId)
      if (!cocoons.length) {
        if (all.some(s => s.monster!.monsterId.startsWith('unresolved:') && s.monster!.race === 'swarm' && s.monster!.rarity === 'boss'))
          throw new ModelUnavailableError('蛊虫首领身份未确认：请识别完整名称或确认是否为空心茧')
        warn('没有仍保持空心茧身份的怪物，空心虫母不生效'); break
      }
      const percent = all.reduce((sum, s) => sum + (s.monster!.race === 'swarm'
        ? { common: 15, magic: 30, rare: 75, boss: 75 }[s.monster!.rarity] : 0), 0)
      const quantityNumerator = all.reduce((sum, s) => sum + s.monster!.quantity, 0) * (100 + percent)
      const activityNumerator = all.reduce((sum, s) => sum + s.monster!.unitActivity, 0) * (100 + percent)
      if (!Number.isSafeInteger(quantityNumerator) || !Number.isSafeInteger(activityNumerator)
        || quantityNumerator % 100 || activityNumerator % 100)
        throw new ModelUnavailableError('空心虫母加成结果需要取整或超出安全精度；取整规则未确认，不擅自舍入')
      all.forEach(s => remove(s, source))
      add({ base: { monsterId: cocoonId, race: 'swarm', rarity: 'boss',
        quantity: quantityNumerator / 100, unitActivity: activityNumerator / 100 } }, source)
      emit({ type: 'fusionCompleted', source })
      warn('百分比先相加再乘融合后的数量/活性总和；按“每组蛊虫”字面包含空心茧自身，此计数口径仍待实测')
      break
    }
    case 'communion': {
      const all = occupied()
      if (!all.length) throw new ModelUnavailableError('圣餐空场生成零属性的行为未确认')
      const quantity = all.reduce((sum, s) => sum + s.monster!.quantity, 0)
      const unitActivity = all.reduce((sum, s) => sum + s.monster!.unitActivity, 0)
      all.forEach(s => remove(s, source))
      for (let i = 0; i < 6; i++) {
        const rarity = pick(rarityIds, random)
        add({ base: { monsterId: `class:awakened:${rarity}`, race: 'awakened', rarity, quantity, unitActivity } }, source)
      }
      warn('圣餐先移除全部，再生成六组觉醒者，之后处理常驻；稀有度各自抽样且暂按等概率，非实测出率')
      break
    }
    case 'disease': {
      if (free()) freshConstruct('boss')
      else throw new ModelUnavailableError('病躯满槽：已确认最高总活性目标升级首领骨卫兵且基础属性增加，但增量/成长保留公式未知；需要升级前后样本')
      break
    }
    case 'skeleton': {
      occupied().filter(s => s.monster!.race !== 'construct').forEach(s => remove(s, source))
      freshConstruct('boss')
      while (free()) freshConstruct()
      const constructs = occupied().filter(s => s.monster!.race === 'construct')
      for (const s of constructs) {
        s.monster!.quantity += 199 * constructs.length
        s.monster!.unitActivity += 199 * constructs.length
      }
      warn('完整骨架即时结算：先移除/生成/填满，再按当前骨卫兵组数乘199；随机稀有度暂按等概率，随后处理常驻')
      break
    }
  }
}
