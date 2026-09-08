import type {
  CandidateCard,
  GameState,
  PersistentCard,
  RaceId,
  RarityId,
} from '../types/game'
import { realCardCatalog } from './realCardCatalog'
import { implementedPersistent } from '../planner/persistentCatalog'
import { confirmedPotions } from '../planner/confirmedPotions'

export const raceLabels: Record<RaceId, string> = {
  awakened: '觉醒者',
  aberrant: '异魔',
  swarm: '蛊虫',
  construct: '骨卫兵',
}

export const rarityLabels: Record<RarityId, string> = {
  common: '普通',
  magic: '魔法',
  rare: '稀有',
  boss: '首领',
}

const legacyPersistentCards: PersistentCard[] = [
  {
    id: 'none',
    name: '无常驻加成',
    description: '只计算候选卡本身的即时效果。',
  },
  {
    id: 'raging-blood',
    name: '狂怒之血（示例）',
    description: '所有新增活性提高 20%。',
    globalGainMultiplier: 1.2,
  },
  {
    id: 'aberrant-culture',
    name: '异魔培养（示例）',
    description: '异魔获得的新增活性提高 35%，每个转化单位再获得 8 活性。',
    targetGainMultiplier: { aberrant: 1.35 },
    conversionBonusPerUnit: { aberrant: 8 },
    strategicProfile: {
      summary: '保留至少一组异魔，承接异魔专属活性倍率。',
      rules: [{
        type: 'groupThreshold',
        race: 'aberrant',
        targetCount: 1,
        progressValue: 35,
        completionBonus: 20,
        label: '异魔培养载体',
      }],
    },
  },
  {
    id: 'single-host',
    name: '单一宿主（示例）',
    description: '结算后仅剩一个种族时，总活性提高 25%。',
    singleRaceFinalMultiplier: 1.25,
    strategicProfile: {
      summary: '逐步收束为单一种群，保留最终倍率的成型路线。',
      rules: [{
        type: 'singleRace',
        completionBonus: 110,
        penaltyPerExtraRace: 25,
        label: '单一种群成型度',
      }],
    },
  },
  {
    id: 'molting-cortex',
    name: '蜕生脑皮层',
    description: '回合结束时，随机将 2 组魔法怪物融合为 1 组稀有觉醒者。',
    roundEndEffect: {
      description: '勾选游戏中实际被随机选中的 2 组魔法怪物。',
      targeting: {
        mode: 'observedRandom',
        minTargets: 2,
        maxTargets: 2,
        prompt: '勾选实际被融合的 2 组魔法怪物',
        allowedRarities: ['magic'],
      },
      effects: [
        {
          type: 'mergeSelected',
          rarity: 'rare',
          outputRace: 'awakened',
        },
      ],
    },
    strategicProfile: {
      summary: '积累两组魔法怪物，为回合结束融合稀有觉醒者做准备。',
      rules: [{
        type: 'groupThreshold',
        rarity: 'magic',
        targetCount: 2,
        progressValue: 30,
        completionBonus: 80,
        label: '魔法怪物融合准备',
      }],
    },
  },
  {
    id: 'black-goat-suture',
    name: '黑山羊肠缝线',
    description: '回合结束时，每凑齐 3 组相同稀有度怪物，将其融合为 1 组高一阶稀有度怪物。',
    roundEndEffect: {
      description: '选择本次实际发生融合的 3 组同稀有度怪物。',
      repeatWhileEligible: true,
      targeting: {
        mode: 'choose',
        minTargets: 3,
        maxTargets: 3,
        prompt: '选择 3 组相同稀有度、需要融合的怪物',
        excludeBoss: true,
        requireSameRarity: true,
      },
      effects: [
        {
          type: 'mergeSelected',
          upgradeSteps: 1,
          requireSameRarity: true,
        },
      ],
    },
    strategicProfile: {
      summary: '保留并凑齐三组相同稀有度怪物，形成融合机会。',
      rules: [{
        type: 'largestRaritySet',
        targetCount: 3,
        progressValue: 25,
        completionBonus: 100,
        excludeBoss: true,
        label: '同稀有度三连',
      }],
    },
  },
  {
    id: 'plague-madonna',
    name: '疫区圣母像',
    description: '每 2 回合，在每个稀有度中随机选择 1 组怪物，使其提升一阶稀有度。',
    roundEndEffect: {
      description: '仅在偶数回合触发；按游戏结果勾选每个稀有度实际命中的怪物。',
      everyRounds: 2,
      targeting: {
        mode: 'observedRandom',
        minTargets: 1,
        maxTargets: 3,
        prompt: '勾选本次实际命中的怪物，每个稀有度最多 1 组',
        excludeBoss: true,
        maxPerRarity: 1,
        requireEachEligibleRarity: true,
      },
      effects: [{ type: 'upgradeRarity', target: 'selected', steps: 1 }],
    },
    strategicProfile: {
      summary: '保留普通、魔法和稀有层级，扩大每两回合的升阶覆盖。',
      rules: [{
        type: 'upgradableRarityCoverage',
        valuePerRarity: 30,
        label: '可升阶稀有度覆盖',
      }],
    },
  },
  {
    id: 'adhesive-metatarsal',
    name: '粘连跖骨',
    aliases: ['梳造骸骨', '粘造骸骨'],
    description: '至少有 2 组骨卫兵时，每次移除怪物，使随机 1 组怪物 +180 数量。',
    onRemovalQuantityBonus: {
      amount: 180,
      target: 'observedRandom',
      condition: { type: 'minRaceGroups', target: 'construct', value: 2 },
    },
    strategicProfile: {
      summary: '凑齐两组骨卫兵后，把移除事件转化为随机 +180 数量。',
      rules: [{
        type: 'groupThreshold',
        race: 'construct',
        targetCount: 2,
        progressValue: 55,
        completionBonus: 90,
        label: '双骨卫移除增殖',
      }],
    },
  },
  {
    id: 'aberrant-bud',
    name: '孽生肉芽',
    aliases: ['蔓生肉芽'],
    description: '怪物变异为异魔时，使所有怪物 +35 活性。',
    onMutationActivityBonus: { toRace: 'aberrant', amount: 35 },
    strategicProfile: {
      summary: '与会使怪物变异为异魔的效果协同；每次实际变异都会抬升全体活性。',
      rules: [{
        type: 'groupThreshold',
        race: 'aberrant',
        targetCount: 1,
        progressValue: 24,
        completionBonus: 18,
        label: '异魔变异协同',
      }],
    },
  },
  {
    id: 'mottled-liver',
    name: '斑斓肝脏',
    description: '至少有 2 组异魔时，每次发生变异，使所有怪物 +20 活性。',
    modelWarning: '变异跨越两组异魔门槛时，触发时点待验证，暂不计入该次条件收益；路线评分不是活性期望。',
    onMutationActivityBonus: { amount: 20, condition: { type: 'minRaceGroups', target: 'aberrant', value: 2 } },
    strategicProfile: {
      summary: '凑齐两组异魔后寻找变异机会；不要求变异目标一定是异魔。',
      rules: [{ type: 'groupThreshold', race: 'aberrant', targetCount: 2, progressValue: 24, completionBonus: 18, label: '双异魔变异路线' }],
    },
  },
  {
    id: 'human-pupa',
    name: '人蛹标本',
    description: '回合结束时，按当前蛊虫组数 X：随机 X 组怪物各 +8 数量，并重复生效 X 次。',
    modelWarning: '重复 X 次是否包含首次待验证；仅显示 X 至 X+1 轮的保守范围，不是精确期望，不写回怪物。',
    roundEndQuantityPerRaceGroup: { race: 'swarm', amount: 8 },
    strategicProfile: {
      summary: '没有蛊虫时先寻找添加或变异路线；已有蛊虫后保留启动条件并增加蛊虫组数。启动路线是策略偏好，不是假定随机概率或未来收益。',
      rules: [],
    },
  },
  {
    id: 'hypertrophic-pituitary',
    name: '肿大脑垂体',
    description: '拥有稀有或首领觉醒者时，每回合随机 1 组怪物 +80 活性。',
    roundEndEffect: {
      description: '拥有稀有或首领觉醒者时，勾选本回合实际随机命中的 1 组怪物。',
      targeting: {
        mode: 'observedRandom',
        minTargets: 1,
        maxTargets: 1,
        prompt: '勾选肿大脑垂体本回合实际命中的怪物',
      },
      effects: [{
        type: 'addActivity',
        target: 'selected',
        amount: 80,
        condition: {
          type: 'minRaceRarityGroups',
          target: 'awakened',
          rarities: ['rare', 'boss'],
          value: 1,
        },
      }],
    },
    strategicProfile: {
      summary: '保留一组稀有或首领觉醒者，开启每回合随机 +80 活性的成长。',
      rules: [{
        type: 'groupThreshold',
        race: 'awakened',
        rarities: ['rare', 'boss'],
        targetCount: 1,
        progressValue: 24,
        completionBonus: 60,
        label: '稀有觉醒者启动条件',
      }],
    },
  },
  {
    id: 'contracted-claw',
    name: '挛缩指爪',
    description: '移除非骨卫兵怪物时，使随机 1 组怪物 +150 数量；每次移除分别触发，并按游戏结果记录随机目标。',
    onRemovalQuantityBonus: {
      excludedRace: 'construct',
      amount: 150,
      target: 'observedRandom',
    },
    strategicProfile: {
      summary: '保留骨卫兵路线，并把非骨卫兵作为可移除素材，寻找触发随机 +150 数量的机会。',
      rules: [
        {
          type: 'groupThreshold',
          race: 'construct',
          targetCount: 1,
          progressValue: 60,
          completionBonus: 60,
          label: '骨卫兵路线入口',
        },
        {
          type: 'raceAnchor',
          race: 'construct',
          activityMultiplier: 0.4,
          label: '骨卫兵路线资产',
        },
      ],
    },
  },
  {
    id: 'writhing-spinal',
    name: '蠕动脊髓',
    description: '每次添加怪物时，有 75% 概率将其变异为异魔，并使其 +80 活性。',
    onAddGroupExpectedMutation: {
      probability: 0.75,
      toRace: 'aberrant',
      unitActivityBonus: 80,
    },
    strategicProfile: {
      summary: '提高所有新增怪物牌的长期价值；概率变异结果需在每次结算后按实战画面校正。',
      rules: [],
    },
  },
  {
    id: 'leather-restraint',
    name: '生皮革拘束带',
    description: '拥有至少 3 组魔法怪物时，每回合使总活性最高的 1 组怪物 +100 数量。',
    roundEndEffect: {
      description: '拥有至少 3 组魔法怪物时，使总活性最高的 1 组怪物 +100 数量。',
      effects: [{
        type: 'addQuantity',
        target: 'dominant',
        amount: 100,
        condition: { type: 'minRarityGroups', rarity: 'magic', value: 3 },
      }],
    },
    strategicProfile: {
      summary: '积累三组魔法怪物，启动每回合给最高活性组增加数量的成长路线。',
      rules: [{
        type: 'groupThreshold',
        rarity: 'magic',
        targetCount: 3,
        progressValue: 25,
        completionBonus: 100,
        label: '魔法怪物三组门槛',
      }],
    },
  },
  {
    id: 'dirty-bone-scraper',
    name: '脏污刮骨刀',
    description: '回合结束时，所有数量大于 275 的怪物 +20 活性。',
    roundEndEffect: {
      description: '所有数量大于 275 的怪物各 +20 单体活性。',
      effects: [{
        type: 'addActivity',
        target: 'all',
        amount: 20,
        allMatches: true,
        minQuantityExclusive: 275,
      }],
    },
  },
  {
    id: 'clustered-insect-eggs',
    name: '簇生虫卵',
    description: '拥有至少 3 组蛊虫时，每回合添加 1 组蛊虫，并使其 +100 数量。',
    roundEndEffect: {
      description: '拥有至少 3 组蛊虫时，添加 1 组蛊虫，并使其 +100 数量。',
      effects: [{
        type: 'addGroup',
        race: 'swarm',
        quantity: 100,
        condition: { type: 'minRaceGroups', target: 'swarm', value: 3 },
      }],
    },
    strategicProfile: {
      summary: '积累三组蛊虫，启动每回合新增一组高数量蛊虫的铺场路线。',
      rules: [{
        type: 'groupThreshold',
        race: 'swarm',
        targetCount: 3,
        progressValue: 30,
        completionBonus: 120,
        label: '蛊虫三组门槛',
      }],
    },
  },
  {
    id: 'beast-tendon-cord',
    name: '兽筋绞肉索',
    description: '至少有 2 组骨卫兵时，回合结束移除总活性最低的非骨卫兵；随机 1 组骨卫兵获得其活性和数量。当前先用于战略推荐，实际回合结束结算仍需手工录入。',
    strategicProfile: {
      summary: '优先保留并凑齐至少两组骨卫兵，再利用非骨卫兵作为吞噬素材。',
      rules: [{
        type: 'groupThreshold',
        race: 'construct',
        targetCount: 2,
        progressValue: 60,
        completionBonus: 120,
        label: '骨卫兵启动门槛',
      }],
    },
  },
]

export const persistentCards: PersistentCard[] = [
  ...legacyPersistentCards.filter(p => p.id === 'none' || p.name.includes('示例')),
  ...implementedPersistent.map((rule): PersistentCard => {
    const existing = legacyPersistentCards.find(p => p.id === rule.id)
    const text = realCardCatalog.find(p => p.category === '手术用具' && p.name === rule.name)
    return { ...existing, id: rule.id, name: rule.name, description: text?.effectText ?? existing?.description ?? rule.name,
      sharedRules: true,
      modelWarning: '按卡面规则与显式模型计算；随机结果使用后请按 F8 同步，未确认的生成/升阶数值需补充数据。' }
  }),
]

const baseCandidateCards: CandidateCard[] = [
  {
    id: 'mesmerizing-tincture',
    name: '迷魂酊剂',
    rarity: 2,
    description: '选择 1 组怪物，使其觉醒为高一阶稀有度怪物；首领已到上限，不会再次进阶。',
    tags: ['真实卡牌', '选择目标', '稀有度'],
    effects: [{ type: 'upgradeRarity', target: 'selected', steps: 1 }],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择 1 组需要提升稀有度的怪物',
      excludeBoss: true,
    },
  },
  {
    id: 'birth-bone-powder',
    name: '生骨药粉',
    rarity: 2,
    description: '随机 1 组怪物 +40 数量；若为骨卫兵，额外 +127 数量并移除 1 组非骨卫兵。当前先精确结算截图已确认的 +40 数量主效果。',
    tags: ['真实卡牌', '随机目标', '骨卫兵', '数量', '骨卫分支待确认'],
    effects: [{ type: 'addQuantity', target: 'selected', amount: 40 }],
    targeting: {
      mode: 'observedRandom',
      minTargets: 1,
      maxTargets: 1,
      prompt: '勾选游戏中生骨药粉实际随机命中的 1 组怪物',
    },
    rankObservedRandom: 'conservative',
    modelWarning: '当前排名只计算已确认的 +40 数量下界；命中骨卫兵后的额外 +127、移除与常驻连锁尚待完整样本。',
  },
  {
    id: 'twin-hormone-swarm',
    name: '孪生激素-蛊虫',
    rarity: 1,
    description: '选择 1 组怪物，将其变异为蛊虫，并额外添加 1 组同名怪物。当前只结算已确认的种群变异；新增同名组等待实测数值。',
    tags: ['真实卡牌', '选择目标', '蛊虫', '新增同名组', '部分建模'],
    effects: [{ type: 'convertRace', target: 'selected', to: 'swarm' }],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择要变异为蛊虫的 1 组怪物；结算后请按截图补录新增同名组',
    },
    modelCoverage: 'partial',
    modelWarning: '已结算所选怪物变为蛊虫；新增同名组的稀有度、数量、单体活性、落槽规则及蠕动脊髓联动未知，均未计入评分。',
  },
  {
    id: 'mixed-live-leech-solution',
    name: '混合活蛭溶液',
    rarity: 2,
    description: '选择 1 组怪物，使 2 组同稀有度怪物各 +31 单体活性。当前仅登记卡面规则；同稀有度不足 2 组时的结算方式等待实测。',
    tags: ['真实卡牌', '选择目标', '同稀有度', '单体活性', '规则待确认'],
    effects: [],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择卡面要求的 1 组怪物；若同稀有度不足 2 组，请记录游戏实际结果',
    },
    modelCoverage: 'unresolved',
    modelWarning: '当前局面只有 1 组普通怪物，无法确认“2 组同稀有度怪物”在目标不足时是部分生效、不可选择还是生成其他结果，因此暂按 0 已确认收益参与保守排名。',
  },
  {
    id: 'potent-exorcising-powder',
    name: '强效祛异药粉',
    rarity: 2,
    description: '选择 1 组怪物，使其 +154 数量，并按实际结果移除至多 2 组不同种群怪物；没有可移除对象时只结算数量增益。',
    tags: ['真实卡牌', '选择目标', '移除两组', '数量', '常驻连锁'],
    effects: [
      { type: 'addQuantity', target: 'selected', amount: 154 },
      {
        type: 'removeObservedGroups',
        count: 2,
        differentRaceFromSelected: true,
        allowFewerWhenUnavailable: true,
      },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择获得 +154 数量的怪物组',
    },
    resolutionObservation: {
      removals: {
        count: 2,
        prompt: '记录实际移除的至多 2 组不同种群怪物；候选不足时可保留为空',
        differentRaceFromPrimaryTarget: true,
        allowFewerWhenUnavailable: true,
      },
    },
  },
  {
    id: 'soft-meningeal-solution',
    name: '软脑膜溶液',
    rarity: 3,
    description: '选择 1 组怪物 +30 单体活性；魔法觉醒者生效 2 次，稀有和首领觉醒者生效 3 次。',
    tags: ['真实卡牌', '选择目标', '觉醒者', '单体活性', '稀有药剂'],
    effects: [{
      type: 'addActivity',
      target: 'selected',
      amount: 30,
      repeatOnlyRace: 'awakened',
      repeatByRarity: { magic: 2, rare: 3, boss: 3 },
    }],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择获得活性增益的 1 组怪物',
    },
  },
  {
    id: 'probiotic-mold-solution',
    name: '益生霉溶液',
    rarity: 3,
    description: '每拥有 1 组蛊虫，使所有蛊虫 +11 单体活性。',
    tags: ['真实卡牌', '蛊虫', '单体活性', '稀有药剂'],
    effects: [{
      type: 'addActivity',
      target: 'swarm',
      amount: 11,
      allMatches: true,
      repeatPerRaceGroup: 'swarm',
    }],
  },
  {
    id: 'active-cultivation-powder',
    name: '活殖药粉',
    rarity: 2,
    description: '随机 4 组稀有度各不相同的怪物，各 +32 数量；按实际命中的槽位记录。',
    tags: ['真实卡牌', '随机目标', '不同稀有度', '数量'],
    effects: [{ type: 'addQuantity', target: 'selected', amount: 32, allMatches: true }],
    targeting: {
      mode: 'observedRandom',
      minTargets: 1,
      maxTargets: 4,
      maxPerRarity: 1,
      prompt: '勾选游戏实际命中的怪物；每种稀有度最多 1 组，数量不足时可能只命中部分稀有度',
    },
    rankObservedRandom: 'conservative',
  },
  {
    id: 'large-potion-box',
    name: '药剂箱（大）',
    rarity: 3,
    description: '展开 5 支随机药剂，展开后的牌池不再包含药剂箱；展开后请继续录入实际出现的药剂。',
    tags: ['真实卡牌', '展开后续', '随机药剂', '待观察'],
    effects: [],
    followUpOfferCount: 5,
  },
  {
    id: 'small-potion-box',
    name: '药剂箱（小）',
    rarity: 3,
    description: '包含 3 支随机药剂；展开后的牌池不再包含药剂箱。',
    tags: ['真实卡牌', '展开后续', '随机药剂', '实测卡面'],
    effects: [],
    followUpOfferCount: 3,
  },
  {
    id: 'rare-small-potion-box',
    name: '稀有药剂箱（小）',
    rarity: 3,
    description: '包含 3 支随机药剂，更有可能出现高稀有度药剂；展开后请继续录入实际出现的药剂。',
    tags: ['真实卡牌', '展开后续', '随机药剂', '实测卡面'],
    effects: [],
    followUpOfferCount: 3,
    modelWarning: '“更有可能”的具体抽取权重未知，不能据此计算重抽期望。',
  },
  {
    id: 'active-oviposition-hormone',
    name: '活性育卵激素',
    rarity: 2,
    description: '添加 1 组蛊虫，有 50% 概率额外添加 2 组。',
    tags: ['真实卡牌', '添加', '概率', '蛊虫', '魔法药剂'],
    effects: [],
    evaluationUnavailable: true,
    modelCoverage: 'unresolved',
    modelWarning: '已收录效果；新蛊虫的初始数量、单体活性与稀有度未确认，不能用旧示例初值计算期望。请在游戏使用后按 F8 读取实际结果。',
  },
  {
    id: 'fresh-spinal-powder',
    name: '鲜脊髓药粉',
    rarity: 3,
    description: '随机将至多 3 组非异魔怪物变异为异魔；每成功变异 1 组，使随机 3 组异魔各 +42 数量。',
    tags: ['真实卡牌', '随机目标', '变异', '异魔', '稀有药剂'],
    effects: [],
    evaluationUnavailable: true,
    modelCoverage: 'unresolved',
    modelWarning: '已收录效果；两阶段随机变异/加数量尚未建模，异魔不足 3 组时的目标分配与重复命中规则待确认。不是零收益，也不能手选随机目标；使用后按 F8 同步。',
  },
  {
    id: 'petrifying-spinal-solution',
    name: '石化脊髓溶液',
    rarity: 3,
    description: '选择 1 组怪物 +20 单体活性；若不是异魔，则变异为异魔并额外 +30 单体活性。',
    tags: ['真实卡牌', '选择目标', '变异', '异魔', '稀有药剂'],
    effects: [
      { type: 'addActivity', target: 'selected', amount: 20 },
      { type: 'convertRace', target: 'selected', to: 'aberrant', bonusPerUnit: 30, onlyIfDifferent: true },
    ],
    targeting: { mode: 'choose', minTargets: 1, maxTargets: 1, prompt: '选择获得活性并在非异魔时变异的怪物' },
  },
  {
    id: 'molting-skin-solution',
    name: '蜕生皮溶液',
    rarity: 3,
    description: '选择 1–2 组怪物，将所选怪物融合为 1 组蛊虫。',
    tags: ['真实卡牌', '选择目标', '融合', '蛊虫', '稀有药剂'],
    effects: [{ type: 'mergeSelected', minTargets: 1, outputRace: 'swarm' }],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 2,
      prompt: '选择 1–2 组需要融合为蛊虫的怪物',
    },
    modelWarning: '融合会同时产生移除与添加事件并触发现有常驻；蠕动脊髓仍是 75% 随机结果，应用后按实际画面校正。',
  },
  {
    id: 'digestive-enzyme-solution',
    name: '消化酶溶液',
    rarity: 2,
    description: '选择 1 组怪物，使其 +61 单体活性，并移除其左侧怪物；左侧为空时不产生移除损失。',
    tags: ['真实卡牌', '选择目标', '单体活性', '位置', '移除'],
    effects: [
      { type: 'addActivity', target: 'selected', amount: 61 },
      { type: 'removeLeftOfSelected' },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择获得 +61 活性的怪物；同时检查它左侧的培养皿',
    },
  },
  {
    id: 'gray-matter-spinal-solution',
    name: '灰质脊髓溶液',
    rarity: 2,
    description: '随机 1 组怪物 +41 活性并变异为随机怪物；有 50% 概率再次变异为异魔并 +30 活性。',
    tags: ['真实卡牌', '随机目标', '随机种群', '异魔', '待观察'],
    effects: [
      { type: 'addActivity', target: 'selected', amount: 41 },
      { type: 'convertRace', target: 'selected', to: 'observed' },
    ],
    targeting: {
      mode: 'observedRandom',
      minTargets: 1,
      maxTargets: 1,
      prompt: '记录实际随机命中的怪物及其第一次变异后的种群',
      observedRaces: {
        mode: 'perTarget',
        prompt: '记录第一次随机变异后的种群',
      },
    },
    rankObservedRandom: 'conservative',
    modelWarning: '50% 的再次异魔变异与 +30 活性尚未自动写回；应用后需按游戏结果修正。',
  },
  {
    id: 'aberrant-anesthetic-tincture',
    name: '麻药酊剂-异魔',
    rarity: 1,
    description: '选择 1 组怪物变异为异魔；有 50% 概率再将随机 1 组怪物变异为异魔。',
    tags: ['真实卡牌', '选择目标', '异魔', '随机目标', '待观察'],
    effects: [{ type: 'convertRace', target: 'selected', to: 'aberrant' }],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择必定变异为异魔的怪物',
    },
    modelWarning: '50% 的第二次随机异魔变异尚未自动结算；选择后需按游戏结果修正。',
  },
  {
    id: 'brain-fog-tincture',
    name: '脑雾酊剂',
    rarity: 2,
    description: '随机 1 组怪物 +41 活性；若为觉醒者，则觉醒为稀有怪物。请勾选本次实际随机到的怪物。',
    tags: ['真实卡牌', '随机目标', '觉醒者'],
    effects: [
      { type: 'addActivity', target: 'selected', amount: 41 },
      {
        type: 'setRarity',
        target: 'selected',
        rarity: 'rare',
        onlyRace: 'awakened',
        activityBonusOnChange: 120,
      },
    ],
    targeting: {
      mode: 'observedRandom',
      minTargets: 1,
      maxTargets: 1,
      prompt: '勾选游戏中本次实际随机命中的 1 组怪物',
    },
    rankObservedRandom: 'conservative',
  },
  {
    id: 'pure-holy-water',
    name: '至纯圣水',
    rarity: 3,
    description: '所有觉醒者提升 2 阶稀有度；首领保持首领，不再进阶。',
    tags: ['真实卡牌', '所有觉醒者', '稀有度'],
    effects: [{ type: 'upgradeRarity', target: 'awakened', steps: 2, allMatches: true }],
  },
  {
    id: 'awakened-anesthetic-tincture',
    name: '麻药酊剂-觉醒者',
    rarity: 1,
    description: '选择 1 组怪物，将其变异为觉醒者；若低于魔法稀有度则提升为魔法，首领不会降阶。',
    tags: ['真实卡牌', '选择目标', '觉醒者', '稀有度'],
    effects: [
      { type: 'convertRace', target: 'selected', to: 'awakened' },
      { type: 'setRarity', target: 'selected', rarity: 'magic', allowDowngrade: true },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择 1 组需要变异为魔法觉醒者的怪物',
    },
  },
  {
    id: 'green-bile-solution',
    name: '青胆汁溶液',
    rarity: 2,
    description: '选择 1–2 组怪物，按游戏结果记录各自的随机种群；它们变为魔法怪物并各 +31 活性。',
    tags: ['真实卡牌', '选择目标', '随机种群', '魔法怪物'],
    effects: [
      { type: 'convertRace', target: 'selected', to: 'observed', allMatches: true },
      { type: 'setRarity', target: 'selected', rarity: 'magic', allMatches: true, allowDowngrade: true },
      { type: 'addActivity', target: 'selected', amount: 31, allMatches: true },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 2,
      prompt: '选择 1–2 组实际被变异的怪物',
      observedRaces: {
        mode: 'perTarget',
        prompt: '分别记录游戏中出现的实际随机种群',
      },
    },
  },
  {
    id: 'mutagen-powder',
    name: '诱变药粉',
    rarity: 2,
    description: '选择 1–2 组怪物，各 +52 数量；按游戏结果记录随机种群，并变为稀有怪物。',
    tags: ['真实卡牌', '选择目标', '随机种群', '稀有怪物'],
    effects: [
      { type: 'addQuantity', target: 'selected', amount: 52, allMatches: true },
      { type: 'convertRace', target: 'selected', to: 'observed', allMatches: true },
      { type: 'setRarity', target: 'selected', rarity: 'rare', allMatches: true, allowDowngrade: true },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 2,
      prompt: '选择 1–2 组实际被诱变的怪物',
      observedRaces: {
        mode: 'perTarget',
        prompt: '分别记录游戏中出现的实际随机种群',
      },
    },
  },
  {
    id: 'targeted-xeno-hormone',
    name: '靶向异种激素',
    rarity: 1,
    description: '移除所选 1 组怪物；按游戏结果记录 2 组随机种群的魔法怪物，每组 +25 数量。',
    tags: ['真实卡牌', '选择目标', '移除', '新增怪物', '随机种群'],
    effects: [
      { type: 'removeRace', target: 'selected' },
      { type: 'addObservedGroups', rarity: 'magic', quantity: 25 },
    ],
    targeting: {
      mode: 'choose',
      minTargets: 1,
      maxTargets: 1,
      prompt: '选择需要移除的 1 组怪物',
      observedRaces: {
        mode: 'newGroups',
        count: 2,
        prompt: '记录新增的 2 组魔法怪物的实际随机种群',
      },
    },
  },
  {
    id: 'fine-limb-powder-swarm',
    name: '细肢药粉-蛊虫',
    rarity: 1,
    description: '自动添加 1 组普通蛊虫，并使其 +73 数量；当前按截图基准 15 × 12 初始化后叠加。',
    tags: ['真实卡牌', '蛊虫', '新增怪物', '数量'],
    effects: [{ type: 'addGroup', race: 'swarm', quantity: 73 }],
  },
  {
    id: 'spinal-solution-awakened',
    name: '脊髓溶液-觉醒者',
    rarity: 1,
    description: '自动添加 1 组普通觉醒者，并使其 +31 单体活性；当前按截图基准 15 × 12 初始化后叠加。',
    tags: ['真实卡牌', '觉醒者', '新增怪物', '活性'],
    effects: [{ type: 'addGroup', race: 'awakened', activity: 31 }],
  },
  {
    id: 'fine-limb-powder-construct',
    name: '细肢药粉-骨卫兵',
    rarity: 1,
    description: '自动添加 1 组普通骨卫兵，并使其 +73 数量；当前按截图基准 15 × 12 初始化后叠加。',
    tags: ['真实卡牌', '骨卫兵', '新增怪物', '数量'],
    effects: [{ type: 'addGroup', race: 'construct', quantity: 73 }],
  },
  {
    id: 'spinal-solution-aberrant',
    name: '脊髓溶液-异魔',
    rarity: 1,
    description: '自动添加 1 组普通异魔，并使其 +31 单体活性；当前按截图基准 15 × 12 初始化后叠加。',
    tags: ['真实卡牌', '异魔', '新增怪物', '活性'],
    effects: [{ type: 'addGroup', race: 'aberrant', activity: 31 }],
  },
  {
    id: 'awakened-infusion',
    name: '觉醒灌注',
    rarity: 1,
    description: '觉醒者 +55 活性；已有 120 活性时额外 +35。',
    tags: ['觉醒者', '增益'],
    effects: [
      { type: 'addActivity', target: 'awakened', amount: 55 },
      {
        type: 'addActivity',
        target: 'awakened',
        amount: 35,
        condition: { type: 'minActivity', target: 'awakened', value: 120 },
      },
    ],
  },
  {
    id: 'aberrant-proliferation',
    name: '异魔增殖',
    rarity: 2,
    description: '异魔数量 +2，每个新增单位附带 18 活性。',
    tags: ['异魔', '数量'],
    effects: [
      { type: 'addQuantity', target: 'aberrant', amount: 2, activityPerNewUnit: 18 },
    ],
  },
  {
    id: 'swarm-burst',
    name: '蛊虫爆发',
    rarity: 2,
    description: '蛊虫每个单位获得 14 活性，并额外增加 1 个单位。',
    tags: ['蛊虫', '增殖'],
    effects: [
      { type: 'addActivity', target: 'swarm', amount: 14, perUnit: true },
      { type: 'addQuantity', target: 'swarm', amount: 1, activityPerNewUnit: 10 },
    ],
  },
  {
    id: 'construct-reinforcement',
    name: '骨卫强化',
    rarity: 1,
    description: '骨卫兵至少有 2 个时，获得 85 活性。',
    tags: ['骨卫兵', '条件'],
    effects: [
      {
        type: 'addActivity',
        target: 'construct',
        amount: 85,
        condition: { type: 'minQuantity', target: 'construct', value: 2 },
      },
    ],
  },
  {
    id: 'dominant-stimulant',
    name: '优势刺激剂',
    rarity: 1,
    description: '当前活性最高的种族获得 70 活性。',
    tags: ['通用', '增益'],
    effects: [{ type: 'addActivity', target: 'dominant', amount: 70 }],
  },
  {
    id: 'population-serum',
    name: '群体血清',
    rarity: 1,
    description: '当前数量最多的种族每个单位获得 11 活性。',
    tags: ['通用', '数量'],
    effects: [{ type: 'addActivity', target: 'dominant', amount: 11, perUnit: true }],
  },
  {
    id: 'aberrant-conversion',
    name: '异魔转化',
    rarity: 3,
    description: '将数量最少的非空种族转化为异魔，每个单位额外 +16 活性。',
    tags: ['异魔', '转化'],
    effects: [
      { type: 'convertRace', target: 'lowestQuantity', to: 'aberrant', bonusPerUnit: 16 },
    ],
  },
  {
    id: 'purge-and-feed',
    name: '摘除供养',
    rarity: 2,
    description: '移除活性最低的种族，将其 70% 活性转移给当前优势种族。',
    tags: ['摘除', '转移'],
    effects: [
      {
        type: 'removeRace',
        target: 'lowestActivity',
        transferTo: 'dominant',
        transferRate: 0.7,
      },
    ],
  },
  {
    id: 'activity-doubling',
    name: '高活性催化',
    rarity: 3,
    description: '当前活性最高的种族活性提高 35%。',
    tags: ['通用', '倍率'],
    effects: [{ type: 'multiplyActivity', target: 'dominant', factor: 1.35 }],
  },
  {
    id: 'single-race-surgery',
    name: '单种群手术',
    rarity: 3,
    description: '仅剩一个非空种族时，该种族获得 140 活性。',
    tags: ['单一种族', '终结'],
    effects: [
      {
        type: 'addActivity',
        target: 'dominant',
        amount: 140,
        condition: { type: 'singleRace' },
      },
    ],
  },
]

const projectionUpdates: Record<string, NonNullable<CandidateCard['projection']>> = {
  'mutagen-powder': 'randomRareMutation',
  'green-bile-solution': 'randomMagicMutation',
  'active-oviposition-hormone': 'egg',
  'mixed-live-leech-solution': 'leechRarity',
  'fresh-spinal-powder': 'freshSpinal',
  'birth-bone-powder': 'birthBone',
  'gray-matter-spinal-solution': 'graySpinal',
  'aberrant-anesthetic-tincture': 'aberrantAnesthetic',
}
const chooseOne = { mode: 'choose' as const, minTargets: 1, maxTargets: 1, prompt: '选择游戏中的主目标；随机结果使用后按F8同步' }
const previewNote = '全部已建模分支给出总活性范围，按保守值比较，不假设随机落点等概率；分支或不足目标语义见计算说明。使用后按F8同步真实结果。'
const addedModels: CandidateCard[] = [
  { id: 'rare-potion-box-catalog', name: '稀有药剂箱', rarity: 3, description: '', tags: ['真实卡牌', '药剂箱'],
    effects: [], followUpOfferCount: 3, modelCoverage: 'partial',
    modelWarning: '展开3张已支持；稀有权重未知，不假定只出稀有药剂。' },
  { ...baseCandidateCards.find(c=>c.id==='potent-exorcising-powder')!,
    id: 'exorcising-powder', name: '祛异药粉', description: '', modelCoverage: 'partial',
    projection: 'exorcise',
    effects: [{type:'addQuantity',target:'selected',amount:127},
      {type:'removeObservedGroups',count:1,differentRaceFromSelected:true,allowFewerWhenUnavailable:true}],
    resolutionObservation: {removals:{count:1,prompt:'记录被移除的不同种群怪物',differentRaceFromPrimaryTarget:true,allowFewerWhenUnavailable:true}},
    requiresScreenSync: true,
    modelWarning: '已有不同种群时计算所有移除落点；没有可移除目标时沿用同系列强效药粉的已验证部分生效解释，普通版本仍需实测核对。',
  },
  { id: 'cleansing-ointment', name: '清疽油膏', rarity: 3, description: '', tags: ['真实卡牌', '选择目标', '右侧移除'],
    effects: [], projection: 'cleansing', requiresScreenSync: true, targeting: chooseOne, modelWarning: previewNote },
  { id: 'pure-live-leech-solution', name: '纯粹活蛭溶液', rarity: 2, description: '', tags: ['真实卡牌', '同种群', '范围计算'],
    effects: [], projection: 'leechRace', requiresScreenSync: true, targeting: chooseOne, modelWarning: previewNote },
  { id: 'hollow-spinal-solution', name: '空心脊髓溶液', rarity: 2, description: '', tags: ['真实卡牌', '50%变异', '范围计算'],
    effects: [], projection: 'hollowSpinal', requiresScreenSync: true, targeting: chooseOne, modelWarning: previewNote },
  { id: 'twin-hormone-construct', name: '孪生激素-骨卫兵', rarity: 1, description: '', tags: ['真实卡牌', '骨卫兵', '变异'],
    effects: [{ type: 'convertRace', target: 'selected', to: 'construct' }, { type: 'addQuantity', target: 'selected', amount: 62 }],
    targeting: chooseOne, modelCoverage: 'confirmed' },
  { id: 'quick-cardiotonic', name: '速效强心剂', rarity: 3, description: '', tags: ['真实卡牌', '最低总活性'],
    effects: [{ type: 'addActivity', target: 'selected', amount: 42 }, { type: 'addQuantity', target: 'selected', amount: 42 }],
    targeting: { mode: 'observedRandom', minTargets: 1, maxTargets: 1, prompt: '记录最低总活性的实际命中目标' },
    modelCoverage: 'partial', projection: 'lowestBoost', requiresScreenSync: true,
    modelWarning: previewNote },
  ...([
    ['bone-dissolving-ointment', '化骨油膏', 'boneOil'],
    ['plague-peat-poultice', '疫区泥炭敷料', 'peat'],
    ['compound-reviving-pill', '复方焕生丸剂', 'compound'],
  ] as const).map(([id, name, projection]): CandidateCard => ({
    id, name, projection, rarity: 3, description: '', tags: ['真实卡牌', '范围计算'], effects: [],
    requiresScreenSync: true, modelCoverage: 'partial', modelWarning: previewNote,
  })),
  ...realCardCatalog.filter(e => e.category === '特殊药剂' && /寄生虫卵|寄生虫蛹|寄生蝶|异种万灵药|除虫术|驱魔术|开颅术/.test(e.name))
    .map((e): CandidateCard => ({
      id: `modeled-${e.id}`, name: e.name, description: e.effectText, rarity: 3,
      tags: ['真实卡牌', '特殊药剂', '仅即时效果'], effects: [], requiresScreenSync: true, excludeFromRedraw: true,
      projection: /除虫术|驱魔术|开颅术/.test(e.name) ? 'seriesRemoval' : 'seriesMutation',
      targeting: /寄生/.test(e.name) ? chooseOne : e.name.includes('异种万灵药')
        ? { mode: 'observedRandom', minTargets: 1, maxTargets: 1, prompt: '随机落点不可指定' } : undefined,
      rankObservedRandom: 'conservative', modelCoverage: 'partial', modelWarning: '仅量化本张即时效果；后续专属发牌由F8识别，不加入普通重抽池。',
    })),
]

const knownModels = [...baseCandidateCards, ...addedModels].map((card): CandidateCard => {
  const source = realCardCatalog.find(entry => entry.name === card.name)
  const projection = projectionUpdates[card.id] ?? card.projection
  if (projection) return { ...card, projection, evaluationUnavailable: false, requiresScreenSync: true,
    requiresNewbornSwarm: projection === 'egg',
    effects: [], description: source?.effectText ?? card.description, modelCoverage: 'partial',
    modelWarning: previewNote, tags: ['真实卡牌', '范围计算', 'F8同步'] }
  if (addedModels.some(item => item.id === card.id)) return { ...card, description: source?.effectText ?? card.description }
  return card
})
// Catalog coverage is separate from numeric coverage. Never silently turn an
// unimplemented card into a zero-effect card or drop a recognized new candidate.
const cataloguedCandidates: CandidateCard[] = [
  ...knownModels,
  ...realCardCatalog.filter(entry => entry.category !== '手术用具' && !knownModels.some(card => card.name === entry.name))
    .map((entry): CandidateCard => ({
      id: `catalog-${entry.id}`, name: entry.name, rarity: entry.category === '普通药剂' ? 1 : entry.category === '魔法药剂' ? 2 : 3,
      description: entry.effectText, tags: ['真实卡牌', entry.category], effects: [],
      evaluationUnavailable: true, modelCoverage: 'unresolved', excludeFromRedraw: entry.category === '特殊药剂',
      ...(entry.name === '异种激素' ? {
        randomReplacementCount: 4, requiresScreenSync: true,
        targeting: { mode: 'choose' as const, minTargets: 1, maxTargets: 2, prompt: '选择移除的1–2组；新增随机怪物属性需游戏结果确认' },
      } : {}),
      modelWarning: entry.category === '特殊药剂'
        ? '已收录原文；特殊药剂涉及专属怪物、复制属性或跨回合发牌，缺少完整规则，不进入普通重抽池。'
        : /添加|获得|同名|复制/.test(entry.effectText)
          ? '已收录原文；新增/同名怪物基础属性或复制规则需要确认，不能套用旧示例初值。'
          : '已收录原文；目标规则或复合效果尚未完整建模，禁止当作零收益或套用相似牌效果。',
    })),
]

export const candidateCards: CandidateCard[] = cataloguedCandidates.map(card => {
  const rule = confirmedPotions.find(item => item.id === card.id)
  if (!rule) return card
  return { ...card, confirmedPotion: true, projection: undefined, effects: [],
    evaluationUnavailable: false, requiresNewbornSwarm: false, requiresScreenSync: true,
    resolutionObservation: undefined, rankObservedRandom: undefined,
    description: rule.name === '蜕生皮溶液'
      ? '必须选择2组怪物，融合为1组随机稀有度蛊虫；数量与单体活性分别相加。'
      : rule.name === '解剖浸液：病躯'
        ? '有空位获得1组首领骨卫兵；满槽将总活性最高者变异/升级为首领骨卫兵，基础数量和活性增加（增量待确认）；下一轮额外发放1支特殊药剂。'
      : realCardCatalog.find(entry => entry.name === card.name)?.effectText ?? card.description,
    targeting: rule.targeting?.mode === 'choose' ? {
      mode: 'choose', minTargets: rule.targeting.min, maxTargets: rule.targeting.max,
      prompt: `选择${rule.targeting.min === rule.targeting.max ? rule.targeting.min : `${rule.targeting.min}–${rule.targeting.max}`}组；游戏使用后F8同步`,
    } : undefined,
    modelCoverage: 'partial', modelWarning: '2026-09-08用户校准机制；出生/专属基础值、随机出率及规则边界见计算说明，缺失数据不作完整推荐。',
    tags: ['真实卡牌', '用户确认机制', '分支预览', 'F8同步'] }
})

export const initialState: GameState = {
  round: 3,
  mode: 'activity',
  monsters: [
    { id: 'slot-1', race: 'awakened', rarity: 'common', quantity: 2, unitActivity: 110 },
    { id: 'slot-2', race: 'aberrant', rarity: 'magic', quantity: 3, unitActivity: 95 },
    { id: 'slot-3', race: 'swarm', rarity: 'rare', quantity: 4, unitActivity: 130 },
    { id: 'slot-4', race: 'construct', rarity: 'boss', quantity: 1, unitActivity: 40 },
    { id: 'slot-5', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
    { id: 'slot-6', race: null, rarity: 'common', quantity: 0, unitActivity: 0 },
  ],
}

export const initialCandidateIds = [
  'mesmerizing-tincture',
  'brain-fog-tincture',
  'pure-holy-water',
  'aberrant-proliferation',
  'activity-doubling',
]
