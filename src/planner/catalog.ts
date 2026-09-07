import { candidateCards, persistentCards } from '../data/sampleLibrary'
import { realCardCatalog } from '../data/realCardCatalog'
import type { CardDefinition, PersistentDefinition, PlannerModel, Selector, TargetRule } from './types'

const selected: Selector = { mode: 'selected' }
const all: Selector = { mode: 'all' }
const chooseOne: TargetRule = { mode: 'choose', min: 1, max: 1 }
const chooseTwo: TargetRule = { mode: 'choose', min: 1, max: 2 }
export const implementedCards: CardDefinition[] = [
  { id: 'soft-meningeal-solution', name: '软脑膜溶液', targeting: chooseOne,
    effects: [{ type: 'stats', target: selected, activity: 30, awakenedRarityRepeat: true }] },
  { id: 'probiotic-mold-solution', name: '益生霉溶液',
    effects: [{ type: 'stats', target: { mode: 'all', filter: { race: 'swarm' } }, activity: 11, repeatPerRace: 'swarm' }] },
  { id: 'petrifying-spinal-solution', name: '石化脊髓溶液', targeting: chooseOne,
    effects: [{ type: 'stats', target: selected, activity: 20 },
      { type: 'mutate', target: selected, race: 'aberrant', onlyIfDifferentRace: true, activityBonus: 30 }] },
  { id: 'digestive-enzyme-solution', name: '消化酶溶液', targeting: chooseOne,
    effects: [{ type: 'stats', target: selected, activity: 61 }, { type: 'removeNeighbor', offset: -1 }] },
  { id: 'twin-hormone-construct', name: '孪生激素-骨卫兵', targeting: chooseOne,
    effects: [{ type: 'mutate', target: selected, race: 'construct' }, { type: 'stats', target: selected, quantity: 62 }] },
  { id: 'aberrant-anesthetic-tincture', name: '麻药酊剂-异魔', targeting: chooseOne,
    effects: [{ type: 'mutate', target: selected, race: 'aberrant' },
      { type: 'chance', probability: .5, effects: [{ type: 'mutate', target: { mode: 'random' }, race: 'aberrant' }] }] },
  { id: 'birth-bone-powder', name: '生骨药粉', targeting: { mode: 'random', min: 1, max: 1 },
    effects: [{ type: 'stats', target: selected, quantity: 40 },
      { type: 'ifSelected', filter: { race: 'construct' }, effects: [
        { type: 'stats', target: selected, quantity: 127 },
        { type: 'remove', target: { mode: 'random', filter: { excludeRace: 'construct' } } },
      ] }] },
  { id: 'cleansing-ointment', name: '清疽油膏', targeting: chooseOne,
    effects: [{ type: 'stats', target: selected, activity: 20 },
      { type: 'ifSelected', filter: { race: 'construct' }, effects: [
        { type: 'stats', target: selected, quantity: 41 }, { type: 'removeNeighbor', offset: 1 },
      ] }] },
  { id: 'fine-limb-powder-swarm', name: '细肢药粉-蛊虫',
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'swarm' }, quantityBonus: 73 } }] },
  { id: 'spinal-solution-awakened', name: '脊髓溶液-觉醒者',
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'awakened' }, activityBonus: 31 } }] },
  { id: 'fine-limb-powder-construct', name: '细肢药粉-骨卫兵',
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'construct' }, quantityBonus: 73 } }] },
  { id: 'spinal-solution-aberrant', name: '脊髓溶液-异魔',
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'aberrant' }, activityBonus: 31 } }] },
  { id: 'active-oviposition-hormone', name: '活性育卵激素',
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'swarm' } } },
      { type: 'chance', probability: .5, effects: [{ type: 'add', count: 2, spec: { filter: { race: 'swarm' } } }] }] },
  { id: 'targeted-xeno-hormone', name: '靶向异种激素', targeting: chooseOne,
    effects: [{ type: 'remove', target: selected },
      { type: 'add', count: 2, spec: { filter: { rarities: ['magic'] }, quantityBonus: 25 } }] },
  { id: 'mesmerizing-tincture', name: '迷魂酊剂',
    targeting: { ...chooseOne, filter: { rarities: ['common', 'magic', 'rare'] } },
    effects: [{ type: 'mutate', target: selected, upgradeSteps: 1 }] },
  { id: 'pure-holy-water', name: '至纯圣水',
    effects: [{ type: 'mutate', target: { mode: 'all', filter: { race: 'awakened' } }, upgradeSteps: 2 }] },
  { id: 'awakened-anesthetic-tincture', name: '麻药酊剂-觉醒者', targeting: chooseOne,
    effects: [{ type: 'mutate', target: selected, race: 'awakened', rarity: 'magic' }] },
  { id: 'green-bile-solution', name: '青胆汁溶液', targeting: chooseTwo,
    effects: [{ type: 'mutate', target: selected, race: 'random', rarity: 'magic' },
      { type: 'stats', target: selected, activity: 31 }] },
  { id: 'mutagen-powder', name: '诱变药粉', targeting: chooseTwo,
    effects: [{ type: 'stats', target: selected, quantity: 52 },
      { type: 'mutate', target: selected, race: 'random', rarity: 'rare' }] },
]
export const implementedPersistent: PersistentDefinition[] = [
  { id: 'dirty-bone-scraper', name: '脏污刮骨刀', triggers: [{ event: 'roundEnd',
    effects: [{ type: 'stats', target: { mode: 'all', filter: { minQuantityExclusive: 275 } }, activity: 20 }] }] },
  { id: 'contracted-claw', name: '挛缩指爪', triggers: [{ event: 'removeSucceeded', excludedEventRace: 'construct',
    effects: [{ type: 'stats', target: { mode: 'random' }, quantity: 150 }] }] },
  { id: 'aberrant-bud', name: '孽生肉芽', triggers: [{ event: 'mutationCompleted', eventRace: 'aberrant',
    effects: [{ type: 'stats', target: all, activity: 35 }] }] },
  { id: 'writhing-spinal', name: '蠕动脊髓', triggers: [{ event: 'addSucceeded',
    effects: [{ type: 'chance', probability: .75, effects: [
      { type: 'mutate', target: { mode: 'eventMonster' }, race: 'aberrant', activityBonus: 80 },
    ] }] }] },
  { id: 'hypertrophic-pituitary', name: '肿大脑垂体', triggers: [{ event: 'roundEnd',
    condition: { filter: { race: 'awakened', rarities: ['rare', 'boss'] }, minGroups: 1 },
    effects: [{ type: 'stats', target: { mode: 'random' }, activity: 80 }] }] },
  { id: 'leather-restraint', name: '生皮革拘束带', triggers: [{ event: 'roundEnd',
    condition: { filter: { rarities: ['magic'] }, minGroups: 3 },
    effects: [{ type: 'stats', target: { mode: 'highest' }, quantity: 100 }] }] },
  { id: 'clustered-insect-eggs', name: '簇生虫卵', triggers: [{ event: 'roundEnd',
    condition: { filter: { race: 'swarm' }, minGroups: 3 },
    effects: [{ type: 'add', count: 1, spec: { filter: { race: 'swarm' }, quantityBonus: 100 } }] }] },
]

export function createPlannerModel(overrides: Partial<PlannerModel> = {}): PlannerModel {
  const cards = candidateCards.filter(c => realCardCatalog.some(e => e.name === c.name))
    .map((c): CardDefinition => implementedCards.find(d => d.id === c.id) ?? {
      id: c.id, name: c.name, effects: [], unsupportedReason: '尚未迁移完整效果、目标数量或专属发牌规则',
    })
  const persistent: PersistentDefinition[] = persistentCards.filter(p => p.id !== 'none' && !p.name.includes('示例'))
    .map(p => implementedPersistent.find(d => d.id === p.id) ?? {
      id: p.id, name: p.name, triggers: [], unsupportedReason: p.modelWarning ?? '尚未迁移完整常驻规则',
    })
  return {
    version: 'vorax-planner-v1', cards, persistent,
    offerPool: cards.filter(c => {
      const source = realCardCatalog.find(e => e.name === c.name)!
      return source.category !== '特殊药剂'
    }).map(c => c.id),
    offerCount: 3, offersWithReplacement: false, poolLabel: '底表普通候选池（条件与全卡覆盖尚未完成，会阻止完整规划）',
    monsters: [], raritySamples: [], rarityPriors: {}, persistentOrder: 'acquisition', maxEvents: 1000,
    assumptions: [
      '每轮符合条件的卡牌等概率；默认同轮不放回、跨轮独立，重抽同轮替换候选且不结算常驻。',
      '随机合法目标及极值并列目标等概率；这些是假设，不是实测概率。',
      '卡牌全部效果完成后按事件 FIFO 结算常驻；条件读取处理事件时的局面。',
      '新增常驻下一轮生效；第11至13轮仍结算；暂未模拟培养中额外奖励常驻的出现时点。',
      '常驻获得顺序、同种群同稀有度的同类变异事件语义仍需实测；默认属性未变不触发变异事件。',
      '最终期望依赖显式牌池、规则与后续近似策略；p10是模型分位数，不是真实保底。',
    ],
    ...overrides,
  }
}

export function modelCoverage(model: PlannerModel) {
  return {
    cards: model.cards.map(c => ({ id: c.id, name: c.name, status: c.unsupportedReason ? 'unsupported' : 'implemented',
      note: c.unsupportedReason ?? '算子已实现；生成/稀有度牌仍需要显式数据，需实战校准' })),
    persistent: model.persistent.map(p => ({ id: p.id, name: p.name, status: p.unsupportedReason ? 'unsupported' : 'implemented',
      note: p.unsupportedReason ?? '按已声明事件顺序假设执行' })),
  }
}
