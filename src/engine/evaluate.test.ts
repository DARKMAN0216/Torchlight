import { describe, expect, it } from 'vitest'
import { candidateCards, initialState, persistentCards } from '../data/sampleLibrary'
import type { CandidateCard } from '../types/game'
import { estimateRedraw } from './redraw'
import { evaluateCard, rankCards, totalActivity } from './evaluate'

describe('rule engine', () => {
  it('applies global persistent gain to direct activity', () => {
    const card = candidateCards.find((item) => item.id === 'construct-reinforcement')!
    const persistent = persistentCards.find((item) => item.id === 'raging-blood')!
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster) =>
        monster.race === 'construct' ? { ...monster, quantity: 2 } : { ...monster },
      ),
    }
    const result = evaluateCard(state, card, persistent)

    expect(result.delta).toBe(204)
    expect(result.state.monsters.find((monster) => monster.race === 'construct')?.unitActivity).toBe(142)
  })

  it('ranks the highest immediate result first', () => {
    const persistent = persistentCards[0]
    const ranking = rankCards(initialState, candidateCards.slice(0, 5), persistent)

    expect(ranking[0].activityAfter).toBeGreaterThanOrEqual(ranking.at(-1)!.activityAfter)
  })

  it('returns a redraw estimate over unique combinations', () => {
    const persistent = persistentCards[0]
    const currentBest = totalActivity(initialState)
    const redrawPoolIds = new Set([
      'awakened-infusion',
      'aberrant-proliferation',
      'swarm-burst',
      'construct-reinforcement',
      'dominant-stimulant',
      'population-serum',
    ])
    const redrawPool = candidateCards.filter((card) => redrawPoolIds.has(card.id))
    const estimate = estimateRedraw(
      initialState,
      redrawPool,
      persistent,
      3,
      currentBest,
    )

    expect(estimate.sampleCount).toBe(20)
    expect(estimate.expectedBest).toBeGreaterThan(currentBest)
    expect(estimate.improveProbability).toBeGreaterThan(0)
  })

  it('estimates five-card redraws across the full structured pool without overflowing the stack', () => {
    const estimate = estimateRedraw(
      initialState,
      candidateCards,
      persistentCards[0],
      5,
      totalActivity(initialState),
    )

    expect(estimate.sampleCount).toBe(324632)
    expect(Number.isFinite(estimate.minimumBest)).toBe(true)
    expect(Number.isFinite(estimate.maximumBest)).toBe(true)
  })

  it('preserves per-slot rarity while cloning and evaluating', () => {
    const result = evaluateCard(initialState, candidateCards[0], persistentCards[0])

    expect(result.state.monsters.map((monster) => monster.rarity)).toEqual([
      'common',
      'magic',
      'rare',
      'boss',
      'common',
      'common',
    ])
    expect(result.state.monsters).not.toBe(initialState.monsters)
  })

  it('upgrades the checked monster by one rarity tier', () => {
    const card = candidateCards.find((item) => item.id === 'mesmerizing-tincture')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1'],
    })

    expect(result.state.monsters[0].rarity).toBe('magic')
    expect(result.trace).toContain('槽位 1稀有度：普通 → 魔法')
  })

  it('never advances or changes a boss when a rarity upgrade targets it', () => {
    const card = candidateCards.find((item) => item.id === 'mesmerizing-tincture')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-4'],
    })

    expect(result.state.monsters[3]).toEqual(initialState.monsters[3])
    expect(result.warnings).toContain('槽位 4已是首领，稀有度升阶不生效')
  })

  it('upgrades all awakened groups by two tiers while keeping an awakened boss capped', () => {
    const card = candidateCards.find((item) => item.id === 'pure-holy-water')!
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) =>
        index === 3 ? { ...monster, race: 'awakened' as const } : { ...monster },
      ),
    }
    const result = evaluateCard(state, card, persistentCards[0])

    expect(result.state.monsters[0].rarity).toBe('rare')
    expect(result.state.monsters[3].rarity).toBe('boss')
  })

  it('uses a checked group to record the observed random target', () => {
    const card = candidateCards.find((item) => item.id === 'brain-fog-tincture')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-2'],
    })

    expect(result.state.monsters[1].unitActivity).toBe(136)
    expect(result.state.monsters[1].rarity).toBe('magic')
    expect(result.warnings).toEqual([])
  })

  it('reproduces the observed rare-awakened brain fog result including its +120 awakening gain', () => {
    const card = candidateCards.find((item) => item.id === 'brain-fog-tincture')!
    const state = {
      round: 4,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 45 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'common' as const, quantity: 162, unitActivity: 15 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const result = evaluateCard(state, card, persistentCards[0], {
      selectedMonsterIds: ['slot-3'],
    })

    expect(result.state.monsters[2]).toMatchObject({ rarity: 'rare', unitActivity: 176 })
    expect(result.activityAfter).toBe(42732)
    expect(result.trace).toContain('槽位 3稀有度：普通 → 稀有，+120 单体活性')
  })

  it('reproduces the birth-bone powder screenshot from 720 to 1320 activity', () => {
    const card = candidateCards.find((item) => item.id === 'birth-bone-powder')!
    const persistent = persistentCards.find((item) => item.id === 'contracted-claw')!
    const state = {
      round: 1,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: 'swarm' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-4', race: 'aberrant' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }

    const result = evaluateCard(state, card, persistent, {
      selectedMonsterIds: ['slot-4'],
    })

    expect(result.activityBefore).toBe(720)
    expect(result.state.monsters[3]).toMatchObject({
      quantity: 52,
      unitActivity: 15,
    })
    expect(result.activityAfter).toBe(1320)
    expect(result.delta).toBe(600)
    expect(result.trace).toContain('异魔（槽位 4）数量 +40')
  })

  it('reproduces the potent exorcising powder and contracted claw chain to 7170', () => {
    const card = candidateCards.find((item) => item.id === 'potent-exorcising-powder')!
    const persistent = persistentCards.find((item) => item.id === 'contracted-claw')!
    const state = {
      round: 2,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: 'swarm' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'common' as const, quantity: 12, unitActivity: 15 },
        { id: 'slot-4', race: 'aberrant' as const, rarity: 'common' as const, quantity: 52, unitActivity: 15 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }

    const result = evaluateCard(state, card, persistent, {
      selectedMonsterIds: ['slot-2'],
      observedRemovedMonsterIds: ['slot-1', 'slot-4'],
      observedPersistentTriggerTargetIds: ['slot-2', 'slot-3'],
    })

    expect(result.activityBefore).toBe(1320)
    expect(result.state.monsters[0].race).toBeNull()
    expect(result.state.monsters[1]).toMatchObject({ quantity: 316, unitActivity: 15 })
    expect(result.state.monsters[2]).toMatchObject({ quantity: 162, unitActivity: 15 })
    expect(result.state.monsters[3].race).toBeNull()
    expect(result.activityAfter).toBe(7170)
    expect(result.trace).toContain('挛缩指爪第 1 次触发：骨卫兵（槽位 2）+150 数量')
    expect(result.trace).toContain('挛缩指爪第 2 次触发：觉醒者（槽位 3）+150 数量')

    const ranked = rankCards(state, [card], persistent)[0]
    expect(ranked.recommendedTargetIds).toEqual(['slot-2'])
    expect(ranked.activityAfter).toBe(7170)
    expect(ranked.analysis.some((line) => line.includes('7170–7770'))).toBe(true)
  })

  it('applies soft meningeal solution repeats only to upgraded awakened groups', () => {
    const card = candidateCards.find((item) => item.id === 'soft-meningeal-solution')!
    const magicAwakened = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) =>
        index === 0
          ? { ...monster, race: 'awakened' as const, rarity: 'magic' as const, quantity: 10, unitActivity: 15 }
          : { ...monster },
      ),
    }
    const awakenedResult = evaluateCard(magicAwakened, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1'],
    })
    const nonAwakenedResult = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-2'],
    })

    expect(awakenedResult.state.monsters[0].unitActivity).toBe(75)
    expect(awakenedResult.delta).toBe(600)
    expect(nonAwakenedResult.state.monsters[1].unitActivity).toBe(125)
  })

  it('merges two observed magic groups into one rare awakened group', () => {
    const persistent = persistentCards.find((item) => item.id === 'molting-cortex')!
    const card: CandidateCard = {
      id: 'round-end-test',
      name: '蜕生脑皮层·回合结束',
      rarity: 3,
      description: persistent.roundEndEffect!.description,
      tags: [],
      effects: persistent.roundEndEffect!.effects,
    }
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) =>
        index === 2 ? { ...monster, rarity: 'magic' as const } : { ...monster },
      ),
    }
    const result = evaluateCard(state, card, persistent, {
      selectedMonsterIds: ['slot-2', 'slot-3'],
    })

    expect(result.state.monsters[1]).toMatchObject({
      race: 'awakened',
      rarity: 'rare',
      quantity: 7,
      unitActivity: 225,
    })
    expect(result.state.monsters[2].race).toBeNull()
  })

  it('merges three same-rarity groups and upgrades the result by one tier', () => {
    const persistent = persistentCards.find((item) => item.id === 'black-goat-suture')!
    const card: CandidateCard = {
      id: 'round-end-test',
      name: '黑山羊肠缝线·回合结束',
      rarity: 3,
      description: persistent.roundEndEffect!.description,
      tags: [],
      effects: persistent.roundEndEffect!.effects,
    }
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) =>
        index < 3 ? { ...monster, rarity: 'common' as const } : { ...monster },
      ),
    }
    const result = evaluateCard(state, card, persistent, {
      selectedMonsterIds: ['slot-1', 'slot-2', 'slot-3'],
    })

    expect(result.state.monsters[0]).toMatchObject({
      race: 'awakened',
      rarity: 'magic',
      quantity: 9,
      unitActivity: 335,
    })
    expect(result.state.monsters[1].race).toBeNull()
    expect(result.state.monsters[2].race).toBeNull()
    expect(result.warnings).toContain('融合后种群暂按最左侧目标保留；若游戏结果不同，请手动修正')
  })

  it('rejects a same-rarity fusion when checked groups have different rarities', () => {
    const card: CandidateCard = {
      id: 'invalid-fusion',
      name: '融合测试',
      rarity: 3,
      description: '',
      tags: [],
      effects: [{ type: 'mergeSelected', upgradeSteps: 1, requireSameRarity: true }],
    }
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1', 'slot-2', 'slot-3'],
    })

    expect(result.state.monsters).toEqual(initialState.monsters)
    expect(result.warnings).toContain('所选怪物稀有度不同，融合未生效')
  })

  it('converts one group into a magic awakened group without downgrading a boss', () => {
    const card = candidateCards.find((item) => item.id === 'awakened-anesthetic-tincture')!
    const magicResult = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-3'],
    })
    const bossResult = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-4'],
    })

    expect(magicResult.state.monsters[2]).toMatchObject({ race: 'awakened', rarity: 'magic' })
    expect(bossResult.state.monsters[3]).toMatchObject({ race: 'awakened', rarity: 'boss' })
  })

  it('records separate observed races for both green bile targets', () => {
    const card = candidateCards.find((item) => item.id === 'green-bile-solution')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1', 'slot-3'],
      observedRaceByMonsterId: {
        'slot-1': 'construct',
        'slot-3': 'aberrant',
      },
    })

    expect(result.state.monsters[0]).toMatchObject({
      race: 'construct',
      rarity: 'magic',
      unitActivity: 141,
    })
    expect(result.state.monsters[2]).toMatchObject({
      race: 'aberrant',
      rarity: 'magic',
      unitActivity: 161,
    })
  })

  it('adds quantity and records rare mutations for one or two selected groups', () => {
    const card = candidateCards.find((item) => item.id === 'mutagen-powder')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-2', 'slot-4'],
      observedRaceByMonsterId: {
        'slot-2': 'swarm',
        'slot-4': 'awakened',
      },
    })

    expect(result.state.monsters[1]).toMatchObject({ race: 'swarm', rarity: 'rare', quantity: 55 })
    expect(result.state.monsters[3]).toMatchObject({ race: 'awakened', rarity: 'boss', quantity: 53 })
  })

  it('removes the selected group and fills empty slots with two observed magic groups', () => {
    const card = candidateCards.find((item) => item.id === 'targeted-xeno-hormone')!
    const result = evaluateCard(initialState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1'],
      observedNewGroupRaces: ['swarm', 'construct'],
    })

    expect(result.state.monsters[0]).toMatchObject({
      race: 'swarm',
      rarity: 'magic',
      quantity: 37,
      unitActivity: 15,
    })
    expect(result.state.monsters[4]).toMatchObject({
      race: 'construct',
      rarity: 'magic',
      quantity: 37,
      unitActivity: 15,
    })
  })

  it('warns when the dish has room for only one of two observed new groups', () => {
    const card = candidateCards.find((item) => item.id === 'targeted-xeno-hormone')!
    const fullState = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) => ({
        ...monster,
        race: monster.race ?? (index === 4 ? 'swarm' as const : 'awakened' as const),
      })),
    }
    const result = evaluateCard(fullState, card, persistentCards[0], {
      selectedMonsterIds: ['slot-1'],
      observedNewGroupRaces: ['swarm', 'construct'],
    })

    expect(result.state.monsters.filter((monster) => monster.race !== null)).toHaveLength(6)
    expect(result.warnings).toContain('培养皿已满，未能添加骨卫兵')
  })

  it.each([
    ['fine-limb-powder-swarm', 'swarm', 85, 15],
    ['spinal-solution-awakened', 'awakened', 12, 46],
    ['fine-limb-powder-construct', 'construct', 85, 15],
    ['spinal-solution-aberrant', 'aberrant', 12, 46],
  ] as const)(
    'adds the fixed common group for %s to the leftmost empty slot',
    (cardId, race, quantity, activity) => {
      const card = candidateCards.find((item) => item.id === cardId)!
      const result = evaluateCard(initialState, card, persistentCards[0])

      expect(result.state.monsters[4]).toMatchObject({
        race,
        rarity: 'common',
        quantity,
        unitActivity: activity,
      })
      expect(result.warnings).toEqual([])
    },
  )

  it('applies the persistent activity gain multiplier to a newly added group', () => {
    const card = candidateCards.find((item) => item.id === 'spinal-solution-awakened')!
    const persistent = persistentCards.find((item) => item.id === 'raging-blood')!
    const result = evaluateCard(initialState, card, persistent)

    expect(result.state.monsters[4].unitActivity).toBe(52)
    expect(result.delta).toBe(624)
  })

  it('keeps a full dish unchanged and warns when a fixed group cannot be added', () => {
    const card = candidateCards.find((item) => item.id === 'fine-limb-powder-swarm')!
    const fullState = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) => ({
        ...monster,
        race: monster.race ?? (index === 4 ? 'swarm' as const : 'awakened' as const),
      })),
    }
    const result = evaluateCard(fullState, card, persistentCards[0])

    expect(result.state.monsters).toEqual(fullState.monsters)
    expect(result.warnings).toContain('培养皿已满，未能添加蛊虫')
  })

  it('combines persistent cards and prices writhing spinal as an expected on-add bonus', () => {
    const card = candidateCards.find((item) => item.id === 'spinal-solution-awakened')!
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal'].includes(item.id),
    )
    const result = evaluateCard(initialState, card, loadout)

    expect(result.activityAfter).toBe(1617)
    expect(result.score).toBe(2337)
    expect(result.trace.some((line) => line.includes('期望活性 +720'))).toBe(true)
    expect(result.warnings.some((line) => line.includes('概率事件'))).toBe(true)
  })

  it('applies probiotic mold solution once per existing swarm group to every swarm', () => {
    const card = candidateCards.find((item) => item.id === 'probiotic-mold-solution')!
    const state = {
      ...initialState,
      monsters: initialState.monsters.map((monster, index) => index < 2
        ? { ...monster, race: 'swarm' as const, quantity: (index + 1) * 10, unitActivity: 15 }
        : { ...monster, race: null, quantity: 0, unitActivity: 0 }),
    }
    const result = evaluateCard(state, card, persistentCards[0])

    expect(result.state.monsters[0].unitActivity).toBe(37)
    expect(result.state.monsters[1].unitActivity).toBe(37)
    expect(result.delta).toBe(660)
  })

  it('ranks the round-four active cultivation powder by its conservative random outcome', () => {
    const state = {
      round: 4,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 45 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'common' as const, quantity: 162, unitActivity: 15 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'probiotic-mold-solution',
      'active-cultivation-powder',
      'large-potion-box',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('active-cultivation-powder')
    expect(ranking[0].activityAfter).toBe(17130)
    expect(ranking[0].analysis[0]).toContain('17130–18090')
    expect(ranking[0].recommendedTargetIds).toBeUndefined()
  })

  it('compares the five potions actually expanded from the round-four box', () => {
    const state = {
      round: 4,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 45 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'common' as const, quantity: 162, unitActivity: 15 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'awakened-anesthetic-tincture',
      'birth-bone-powder',
      'molting-skin-solution',
      'brain-fog-tincture',
      'active-cultivation-powder',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('molting-skin-solution')
    expect(ranking[0].recommendedTargetIds).toEqual(['slot-2', 'slot-3'])
    expect(ranking[0].activityAfter).toBe(37680)
    expect(ranking[0].trace).toContainEqual(expect.stringContaining('挛缩指爪第 1 次触发'))
    expect(ranking[0].analysis).toContainEqual(expect.stringContaining('蠕动脊髓'))
    expect(ranking[1].card.id).toBe('brain-fog-tincture')
    expect(ranking[1].activityAfter).toBe(29606)
    expect(ranking[1].analysis[0]).toContain('29606–42732')
  })

  it('recommends digestive enzyme on the round-five board and keeps the empty left slot harmless', () => {
    const state = {
      round: 5,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 45 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'rare' as const, quantity: 162, unitActivity: 176 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'digestive-enzyme-solution',
      'gray-matter-spinal-solution',
      'aberrant-anesthetic-tincture',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('digestive-enzyme-solution')
    expect(ranking[0].recommendedTargetIds).toEqual(['slot-2'])
    expect(ranking[0].activityAfter).toBe(62008)
    expect(ranking[0].state.monsters[0].race).toBeNull()
    expect(ranking[0].trace).toContain('槽位 1为空，左侧移除未产生损失')
    expect(ranking[0].analysis).toContainEqual(expect.stringContaining('回合结束转移收益 +6320'))
  })

  it('recommends active cultivation powder on the confirmed round-six board', () => {
    const state = {
      round: 6,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 126 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'rare' as const, quantity: 162, unitActivity: 176 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'spinal-solution-aberrant',
      'active-cultivation-powder',
      'probiotic-mold-solution',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('active-cultivation-powder')
    expect(ranking[0].recommendedTargetIds).toBeUndefined()
    expect(ranking[0].activityAfter).toBe(73960)
    expect(ranking[0].analysis[0]).toContain('72360–77992')
  })

  it('structures both observed small potion boxes as three-card expansions', () => {
    const card = candidateCards.find((item) => item.id === 'rare-small-potion-box')!
    const standardCard = candidateCards.find((item) => item.id === 'small-potion-box')!

    expect(card.name).toBe('稀有药剂箱（小）')
    expect(card.followUpOfferCount).toBe(3)
    expect(card.modelWarning).toContain('抽取权重未知')
    expect(standardCard.name).toBe('药剂箱（小）')
    expect(standardCard.followUpOfferCount).toBe(3)
  })

  it('applies confirmed remove/add triggers to the round-seven fusion', () => {
    const state = {
      round: 7,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-2', race: 'construct' as const, rarity: 'common' as const, quantity: 316, unitActivity: 146 },
        { id: 'slot-3', race: 'awakened' as const, rarity: 'rare' as const, quantity: 194, unitActivity: 176 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'molting-skin-solution',
      'fine-limb-powder-swarm',
      'rare-small-potion-box',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('molting-skin-solution')
    expect(ranking[0].recommendedTargetIds).toEqual(['slot-2', 'slot-3'])
    expect(ranking[0].activityAfter).toBe(212520)
    expect(ranking[0].state.monsters[0]).toMatchObject({
      race: 'swarm',
      quantity: 660,
      unitActivity: 322,
    })
    expect(ranking[0].state.monsters[1].race).toBeNull()
    expect(ranking[0].trace).toContainEqual(expect.stringContaining('挛缩指爪第 1 次触发'))
    expect(ranking[0].analysis).toContainEqual(expect.stringContaining('期望活性 +39600'))

    const observedResult = evaluateCard(state, ranking[0].card, loadout, {
      selectedMonsterIds: ['slot-2', 'slot-3'],
      observedAddedGroupMutationIdsByCardId: { 'writhing-spinal': ['slot-1'] },
    })
    expect(observedResult.activityAfter).toBe(265320)
    expect(observedResult.state.monsters[0]).toMatchObject({
      race: 'aberrant',
      quantity: 660,
      unitActivity: 402,
    })
    expect(observedResult.analysis).toContainEqual(expect.stringContaining('实际触发'))
  })

  it('recommends digestive enzyme for the confirmed round-eight board', () => {
    const state = {
      round: 8,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: 'aberrant' as const, rarity: 'common' as const, quantity: 660, unitActivity: 422 },
        { id: 'slot-2', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-3', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'small-potion-box',
      'spinal-solution-aberrant',
      'digestive-enzyme-solution',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(ranking[0].card.id).toBe('digestive-enzyme-solution')
    expect(ranking[0].recommendedTargetIds).toEqual(['slot-1'])
    expect(ranking[0].activityAfter).toBe(318780)
    expect(ranking[0].trace).toContain('所选怪物左侧没有培养皿，不移除怪物')
  })

  it('keeps the round-ten recommendation conservative when two alternatives are incomplete', () => {
    const state = {
      round: 10,
      mode: 'strategic' as const,
      monsters: [
        { id: 'slot-1', race: 'aberrant' as const, rarity: 'common' as const, quantity: 814, unitActivity: 523 },
        { id: 'slot-2', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-3', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-4', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-5', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
        { id: 'slot-6', race: null, rarity: 'common' as const, quantity: 0, unitActivity: 0 },
      ],
    }
    const loadout = persistentCards.filter((item) =>
      ['contracted-claw', 'writhing-spinal', 'dirty-bone-scraper'].includes(item.id),
    )
    const offered = candidateCards.filter((card) => [
      'birth-bone-powder',
      'twin-hormone-swarm',
      'mixed-live-leech-solution',
    ].includes(card.id))
    const ranking = rankCards(state, offered, loadout)

    expect(offered).toHaveLength(3)
    expect(ranking[0].card.id).toBe('birth-bone-powder')
    expect(ranking[0].activityAfter).toBe(446642)
    expect(ranking[0].analysis).toContainEqual(expect.stringContaining('回合结束转移收益 +17080'))

    const twin = ranking.find((result) => result.card.id === 'twin-hormone-swarm')!
    expect(twin.card.modelCoverage).toBe('partial')
    expect(twin.state.monsters[0].race).toBe('swarm')
    expect(twin.activityAfter).toBe(425722)
    expect(twin.trace).toContainEqual(expect.stringContaining('新增同名组'))

    const mixed = ranking.find((result) => result.card.id === 'mixed-live-leech-solution')!
    expect(mixed.card.modelCoverage).toBe('unresolved')
    expect(mixed.activityAfter).toBe(425722)
    expect(mixed.trace).toContainEqual(expect.stringContaining('暂按 0 已确认收益'))

    const scraper = loadout.find((card) => card.id === 'dirty-bone-scraper')!
    const final = evaluateCard(ranking[0].state, {
      id: 'round-end:dirty-bone-scraper',
      name: '脏污刮骨刀·回合结束',
      rarity: 3,
      description: scraper.roundEndEffect!.description,
      tags: ['常驻卡', '回合结束'],
      effects: scraper.roundEndEffect!.effects,
    }, loadout)
    expect(final.activityAfter).toBe(463722)
  })
})
