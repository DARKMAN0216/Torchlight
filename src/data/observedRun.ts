import type { EvaluationContext, GameState } from '../types/game'

export interface ObservedDecisionStep {
  id: string
  sourceBefore: string
  sourceAfter: string
  persistentCardIds: string[]
  offeredCardNames: string[]
  chosenCardId: string
  context: EvaluationContext
  before: GameState
  afterPotion?: GameState
  roundEndPersistentCardId?: string
  roundEndContext?: EvaluationContext
  after: GameState
  displayedFinalActivity: number
  afterPhase: 'potionSelection' | 'surgeryRewardSelection' | 'expandedPotionSelection' | 'surgeryPlanSelection'
}

export interface ObservedPersistentSelection {
  id: string
  sourceBefore: string
  sourceAfter: string
  roundBefore: number
  roundAfter: number
  beforePersistentCardIds: string[]
  selectedPersistentCardId: string
  afterPersistentCardIds: string[]
  state: GameState
}

export interface ObservedPersistentOffer {
  id: string
  source: string
  round: number
  persistentCardIds: string[]
  offeredPersistentCardIds: string[]
  state: GameState
  displayedFinalActivity: number
}

export interface ObservedPotionOffer {
  id: string
  source: string
  round: number
  persistentCardIds: string[]
  offeredCardNames: string[]
  state: GameState
  displayedFinalActivity: number
}

export interface ObservedSurgeryPlanOffer {
  id: string
  source: string
  round: number
  persistentCardIds: string[]
  plans: Array<{
    name: string
    risk: 'low' | 'high'
  }>
  decisionAuthority: 'player'
  state: GameState
  displayedFinalActivity: number
}

const emptySlot = (index: number) => ({
  id: `slot-${index}`,
  race: null,
  rarity: 'common' as const,
  quantity: 0,
  unitActivity: 0,
})

const roundOne: GameState = {
  round: 1,
  mode: 'strategic',
  monsters: [
    { id: 'slot-1', race: 'swarm', rarity: 'common', quantity: 12, unitActivity: 15 },
    { id: 'slot-2', race: 'construct', rarity: 'common', quantity: 12, unitActivity: 15 },
    { id: 'slot-3', race: 'awakened', rarity: 'common', quantity: 12, unitActivity: 15 },
    { id: 'slot-4', race: 'aberrant', rarity: 'common', quantity: 12, unitActivity: 15 },
    emptySlot(5),
    emptySlot(6),
  ],
}

const roundTwo: GameState = {
  ...roundOne,
  round: 2,
  monsters: roundOne.monsters.map((monster, index) =>
    index === 3 ? { ...monster, quantity: 52 } : { ...monster },
  ),
}

const roundThreeBeforeReward: GameState = {
  round: 3,
  mode: 'strategic',
  monsters: [
    emptySlot(1),
    { id: 'slot-2', race: 'construct', rarity: 'common', quantity: 316, unitActivity: 15 },
    { id: 'slot-3', race: 'awakened', rarity: 'common', quantity: 162, unitActivity: 15 },
    emptySlot(4),
    emptySlot(5),
    emptySlot(6),
  ],
}

const roundThreeReward: GameState = {
  ...roundThreeBeforeReward,
  monsters: roundThreeBeforeReward.monsters.map((monster, index) =>
    index === 1 ? { ...monster, unitActivity: 45 } : { ...monster },
  ),
}

const roundFour: GameState = { ...roundThreeReward, round: 4 }

const roundFourAfterBrainFog: GameState = {
  ...roundFour,
  monsters: roundFour.monsters.map((monster, index) =>
    index === 2
      ? { ...monster, rarity: 'rare' as const, unitActivity: 176 }
      : { ...monster },
  ),
}

const roundFive: GameState = { ...roundFourAfterBrainFog, round: 5 }

const roundFiveAfterDigestiveEnzyme: GameState = {
  ...roundFive,
  monsters: roundFive.monsters.map((monster, index) =>
    index === 1 ? { ...monster, unitActivity: 106 } : { ...monster },
  ),
}

const roundSix: GameState = {
  ...roundFiveAfterDigestiveEnzyme,
  round: 6,
  monsters: roundFiveAfterDigestiveEnzyme.monsters.map((monster, index) =>
    index === 1 ? { ...monster, unitActivity: 126 } : { ...monster },
  ),
}

const roundSixAfterActiveCultivation: GameState = {
  ...roundSix,
  monsters: roundSix.monsters.map((monster, index) =>
    index === 2 ? { ...monster, quantity: 194 } : { ...monster },
  ),
}

const roundSeven: GameState = {
  ...roundSixAfterActiveCultivation,
  round: 7,
  monsters: roundSixAfterActiveCultivation.monsters.map((monster, index) =>
    index === 1 ? { ...monster, unitActivity: 146 } : { ...monster },
  ),
}

const roundSevenAfterFusion: GameState = {
  round: 7,
  mode: 'strategic',
  monsters: [
    { id: 'slot-1', race: 'aberrant', rarity: 'common', quantity: 660, unitActivity: 402 },
    emptySlot(2),
    emptySlot(3),
    emptySlot(4),
    emptySlot(5),
    emptySlot(6),
  ],
}

const roundEight: GameState = {
  ...roundSevenAfterFusion,
  round: 8,
  monsters: roundSevenAfterFusion.monsters.map((monster, index) =>
    index === 0 ? { ...monster, unitActivity: 422 } : { ...monster },
  ),
}

const roundEightAfterDigestiveEnzyme: GameState = {
  ...roundEight,
  monsters: roundEight.monsters.map((monster, index) =>
    index === 0 ? { ...monster, unitActivity: 483 } : { ...monster },
  ),
}

const roundNine: GameState = {
  ...roundEightAfterDigestiveEnzyme,
  round: 9,
  monsters: roundEightAfterDigestiveEnzyme.monsters.map((monster, index) =>
    index === 0 ? { ...monster, unitActivity: 503 } : { ...monster },
  ),
}

const roundNineAfterPotentExorcisingPowder: GameState = {
  ...roundNine,
  monsters: roundNine.monsters.map((monster, index) =>
    index === 0 ? { ...monster, quantity: 814 } : { ...monster },
  ),
}

const roundTen: GameState = {
  ...roundNineAfterPotentExorcisingPowder,
  round: 10,
  monsters: roundNineAfterPotentExorcisingPowder.monsters.map((monster, index) =>
    index === 0 ? { ...monster, unitActivity: 523 } : { ...monster },
  ),
}

const roundTenAfterBirthBonePowder: GameState = {
  ...roundTen,
  monsters: roundTen.monsters.map((monster, index) =>
    index === 0 ? { ...monster, quantity: 854 } : { ...monster },
  ),
}

const roundEleven: GameState = {
  ...roundTenAfterBirthBonePowder,
  round: 11,
  monsters: roundTenAfterBirthBonePowder.monsters.map((monster, index) =>
    index === 0 ? { ...monster, unitActivity: 543 } : { ...monster },
  ),
}

export const observedPersistentOffers: ObservedPersistentOffer[] = [{
  id: 'round-4-second-surgery-reward',
  source: 'design/references/round-4-after-brain-fog-second-surgery-reward-1920x1080.png',
  round: 4,
  persistentCardIds: ['contracted-claw', 'writhing-spinal'],
  offeredPersistentCardIds: [
    'leather-restraint',
    'dirty-bone-scraper',
    'clustered-insect-eggs',
  ],
  state: roundFourAfterBrainFog,
  displayedFinalActivity: 42732,
}]

export const observedPotionOffers: ObservedPotionOffer[] = [
  {
    id: 'round-5-after-dirty-bone-scraper-selection',
    source: 'design/references/round-5-dirty-bone-scraper-added-1920x1080.png',
    round: 5,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['消化酶溶液', '灰质脊髓溶液', '麻药酊剂-异魔'],
    state: roundFive,
    displayedFinalActivity: 42732,
  },
  {
    id: 'round-6-after-digestive-enzyme-and-dirty-bone-scraper',
    source: 'design/references/round-6-after-digestive-enzyme-and-dirty-bone-scraper-2560x1440.png',
    round: 6,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['脊髓溶液-异魔', '活殖药粉', '益生霉溶液'],
    state: roundSix,
    displayedFinalActivity: 68328,
  },
  {
    id: 'round-7-after-active-cultivation-and-dirty-bone-scraper',
    source: 'design/references/round-7-after-active-cultivation-and-dirty-bone-scraper-2560x1440.png',
    round: 7,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['蜕生皮溶液', '细肢药粉-蛊虫', '稀有药剂箱（小）'],
    state: roundSeven,
    displayedFinalActivity: 80280,
  },
  {
    id: 'round-8-after-molting-skin-fusion-chain',
    source: 'design/references/round-8-after-molting-skin-fusion-chain-2560x1392.png',
    round: 8,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['药剂箱（小）', '脊髓溶液-异魔', '消化酶溶液'],
    state: roundEight,
    displayedFinalActivity: 278520,
  },
  {
    id: 'round-9-after-digestive-enzyme-and-dirty-bone-scraper',
    source: 'design/references/round-9-after-digestive-enzyme-and-dirty-bone-scraper-2560x1392.png',
    round: 9,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['强效祛异药粉', '细肢药粉-蛊虫', '细肢药粉-骨卫兵'],
    state: roundNine,
    displayedFinalActivity: 331980,
  },
  {
    id: 'round-10-after-potent-exorcising-powder-and-dirty-bone-scraper',
    source: 'design/references/round-10-after-potent-exorcising-powder-and-dirty-bone-scraper-2560x1392.png',
    round: 10,
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['生骨药粉', '孪生激素-蛊虫', '混合活蛭溶液'],
    state: roundTen,
    displayedFinalActivity: 425722,
  },
]

export const observedSurgeryPlanOffers: ObservedSurgeryPlanOffer[] = [{
  id: 'round-11-surgery-plan-selection',
  source: 'design/references/round-11-surgery-plan-selection-1920x1080.png',
  round: 11,
  persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
  plans: [
    { name: '颅骨钻孔术', risk: 'high' },
    { name: '表皮移植实验', risk: 'low' },
    { name: '全身针灸疗法', risk: 'high' },
  ],
  decisionAuthority: 'player',
  state: roundEleven,
  displayedFinalActivity: 463722,
}]

export const observedPersistentSelections: ObservedPersistentSelection[] = [
  {
    id: 'round-3-add-writhing-spinal',
    sourceBefore: 'design/references/round-3-after-soft-meningeal-reward-selection-1920x1080.png',
    sourceAfter: 'design/references/round-4-writhing-spinal-added-persistent-1920x1080.png',
    roundBefore: 3,
    roundAfter: 4,
    beforePersistentCardIds: ['contracted-claw'],
    selectedPersistentCardId: 'writhing-spinal',
    afterPersistentCardIds: ['contracted-claw', 'writhing-spinal'],
    state: roundFour,
  },
  {
    id: 'round-4-add-dirty-bone-scraper',
    sourceBefore: 'design/references/round-4-after-brain-fog-second-surgery-reward-1920x1080.png',
    sourceAfter: 'design/references/round-5-dirty-bone-scraper-added-1920x1080.png',
    roundBefore: 4,
    roundAfter: 5,
    beforePersistentCardIds: ['contracted-claw', 'writhing-spinal'],
    selectedPersistentCardId: 'dirty-bone-scraper',
    afterPersistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    state: roundFive,
  },
]

export const observedRun: ObservedDecisionStep[] = [
  {
    id: 'round-1-birth-bone-powder',
    sourceBefore: 'design/references/round-1-before-birth-bone-powder-1920x1080.png',
    sourceAfter: 'design/references/round-2-after-birth-bone-powder-1920x1080.png',
    persistentCardIds: ['contracted-claw'],
    offeredCardNames: ['生骨药粉', '活性育卵激素', '卵壳药粉'],
    chosenCardId: 'birth-bone-powder',
    context: { selectedMonsterIds: ['slot-4'] },
    before: roundOne,
    after: roundTwo,
    displayedFinalActivity: 1320,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-2-potent-exorcising-powder',
    sourceBefore: 'design/references/round-2-after-birth-bone-powder-1920x1080.png',
    sourceAfter: 'design/references/round-3-after-potent-exorcising-powder-chain-1920x1080.png',
    persistentCardIds: ['contracted-claw'],
    offeredCardNames: ['活性育卵激素', '软脑膜溶液', '强效祛异药粉'],
    chosenCardId: 'potent-exorcising-powder',
    context: {
      selectedMonsterIds: ['slot-2'],
      observedRemovedMonsterIds: ['slot-1', 'slot-4'],
      observedPersistentTriggerTargetIds: ['slot-2', 'slot-3'],
    },
    before: roundTwo,
    after: roundThreeBeforeReward,
    displayedFinalActivity: 7170,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-3-soft-meningeal-solution',
    sourceBefore: 'design/references/round-3-after-potent-exorcising-powder-chain-1920x1080.png',
    sourceAfter: 'design/references/round-3-after-soft-meningeal-reward-selection-1920x1080.png',
    persistentCardIds: ['contracted-claw'],
    offeredCardNames: ['软脑膜溶液', '脊髓溶液-觉醒者', '靶向异种激素'],
    chosenCardId: 'soft-meningeal-solution',
    context: { selectedMonsterIds: ['slot-2'] },
    before: roundThreeBeforeReward,
    after: roundThreeReward,
    displayedFinalActivity: 16650,
    afterPhase: 'surgeryRewardSelection',
  },
  {
    id: 'round-4-large-potion-box-expansion',
    sourceBefore: 'design/references/round-4-writhing-spinal-added-persistent-1920x1080.png',
    sourceAfter: 'design/references/round-4-large-potion-box-expanded-1920x1080.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal'],
    offeredCardNames: ['益生霉溶液', '活殖药粉', '药剂箱（大）'],
    chosenCardId: 'large-potion-box',
    context: {},
    before: roundFour,
    after: roundFour,
    displayedFinalActivity: 16650,
    afterPhase: 'expandedPotionSelection',
  },
  {
    id: 'round-4-brain-fog-awakened-hit',
    sourceBefore: 'design/references/round-4-large-potion-box-expanded-1920x1080.png',
    sourceAfter: 'design/references/round-4-after-brain-fog-second-surgery-reward-1920x1080.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal'],
    offeredCardNames: ['麻药酊剂-觉醒者', '生骨药粉', '蜕生皮溶液', '脑雾酊剂', '活殖药粉'],
    chosenCardId: 'brain-fog-tincture',
    context: { selectedMonsterIds: ['slot-3'] },
    before: roundFour,
    after: roundFourAfterBrainFog,
    displayedFinalActivity: 42732,
    afterPhase: 'surgeryRewardSelection',
  },
  {
    id: 'round-5-digestive-enzyme-and-dirty-bone-scraper',
    sourceBefore: 'design/references/round-5-dirty-bone-scraper-added-1920x1080.png',
    sourceAfter: 'design/references/round-6-after-digestive-enzyme-and-dirty-bone-scraper-2560x1440.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['消化酶溶液', '灰质脊髓溶液', '麻药酊剂-异魔'],
    chosenCardId: 'digestive-enzyme-solution',
    context: { selectedMonsterIds: ['slot-2'] },
    before: roundFive,
    afterPotion: roundFiveAfterDigestiveEnzyme,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundSix,
    displayedFinalActivity: 68328,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-6-active-cultivation-awakened-hit',
    sourceBefore: 'design/references/round-6-after-digestive-enzyme-and-dirty-bone-scraper-2560x1440.png',
    sourceAfter: 'design/references/round-7-after-active-cultivation-and-dirty-bone-scraper-2560x1440.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['脊髓溶液-异魔', '活殖药粉', '益生霉溶液'],
    chosenCardId: 'active-cultivation-powder',
    context: { selectedMonsterIds: ['slot-3'] },
    before: roundSix,
    afterPotion: roundSixAfterActiveCultivation,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundSeven,
    displayedFinalActivity: 80280,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-7-molting-skin-fusion-chain',
    sourceBefore: 'design/references/round-7-after-active-cultivation-and-dirty-bone-scraper-2560x1440.png',
    sourceAfter: 'design/references/round-8-after-molting-skin-fusion-chain-2560x1392.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['蜕生皮溶液', '细肢药粉-蛊虫', '稀有药剂箱（小）'],
    chosenCardId: 'molting-skin-solution',
    context: {
      selectedMonsterIds: ['slot-2', 'slot-3'],
      observedAddedGroupMutationIdsByCardId: { 'writhing-spinal': ['slot-1'] },
    },
    before: roundSeven,
    afterPotion: roundSevenAfterFusion,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundEight,
    displayedFinalActivity: 278520,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-8-digestive-enzyme-and-dirty-bone-scraper',
    sourceBefore: 'design/references/round-8-after-molting-skin-fusion-chain-2560x1392.png',
    sourceAfter: 'design/references/round-9-after-digestive-enzyme-and-dirty-bone-scraper-2560x1392.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['药剂箱（小）', '脊髓溶液-异魔', '消化酶溶液'],
    chosenCardId: 'digestive-enzyme-solution',
    context: { selectedMonsterIds: ['slot-1'] },
    before: roundEight,
    afterPotion: roundEightAfterDigestiveEnzyme,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundNine,
    displayedFinalActivity: 331980,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-9-potent-exorcising-powder-without-removals',
    sourceBefore: 'design/references/round-9-after-digestive-enzyme-and-dirty-bone-scraper-2560x1392.png',
    sourceAfter: 'design/references/round-10-after-potent-exorcising-powder-and-dirty-bone-scraper-2560x1392.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['强效祛异药粉', '细肢药粉-蛊虫', '细肢药粉-骨卫兵'],
    chosenCardId: 'potent-exorcising-powder',
    context: { selectedMonsterIds: ['slot-1'] },
    before: roundNine,
    afterPotion: roundNineAfterPotentExorcisingPowder,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundTen,
    displayedFinalActivity: 425722,
    afterPhase: 'potionSelection',
  },
  {
    id: 'round-10-birth-bone-powder-and-dirty-bone-scraper',
    sourceBefore: 'design/references/round-10-current-checkpoint-1920x1080.png',
    sourceAfter: 'design/references/round-11-surgery-plan-selection-1920x1080.png',
    persistentCardIds: ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'],
    offeredCardNames: ['生骨药粉', '孪生激素-蛊虫', '混合活蛭溶液'],
    chosenCardId: 'birth-bone-powder',
    context: { selectedMonsterIds: ['slot-1'] },
    before: roundTen,
    afterPotion: roundTenAfterBirthBonePowder,
    roundEndPersistentCardId: 'dirty-bone-scraper',
    roundEndContext: {},
    after: roundEleven,
    displayedFinalActivity: 463722,
    afterPhase: 'surgeryPlanSelection',
  },
]
