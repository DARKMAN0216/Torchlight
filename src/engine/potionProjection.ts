import { raceIds, type CandidateCard, type CardEffect, type EvaluationContext,
  type EvaluationResult, type GameState, type MonsterGroup, type PersistentLoadout } from '../types/game'
import { persistentCardsIn } from './persistent'
import { raceRanges } from './startup'

type Evaluate = (card: CandidateCard, context: EvaluationContext) => EvaluationResult
const on = (ids: string[], effects: CardEffect[]): CardEffect => ({ type: 'withTargets', ids, effects })
const activity = (amount: number): CardEffect => ({ type: 'addActivity', target: 'selected', amount, allMatches: true })
const quantity = (amount: number): CardEffect => ({ type: 'addQuantity', target: 'selected', amount, allMatches: true })
const mutate = (to: MonsterGroup['race']): CardEffect => ({ type: 'convertRace', target: 'selected', to: to!, allMatches: true })

function combinations<T>(items: T[], count: number): T[][] {
  if (!count) return [[]]
  return items.flatMap((item, i) => combinations(items.slice(i + 1), count - 1).map(rest => [item, ...rest]))
}

/** Enumerates mechanical alternatives without assigning unknown target probabilities.
 * Fresh spinal uses an outer bound: allocations may use any eventual aberrants,
 * covering batch/interleaved conversion order. A bound is never applied as reality.
 */
export function projectPotion(source: GameState, card: CandidateCard, loadout: PersistentLoadout,
  context: EvaluationContext, evaluate: Evaluate): EvaluationResult {
  const groups = source.monsters.filter(m => m.race && m.quantity > 0)
  const primary = groups.find(m => m.id === context.selectedMonsterIds?.[0]) ?? groups[0]
  const outcomes: EvaluationResult[] = []
  const notes: string[] = []
  const run = (effects: CardEffect[], branchContext: EvaluationContext = context) => {
    const variant = { ...card, projection: undefined, effects, resolutionObservation: {} }
    const base = evaluate(variant, branchContext)
    // All actually removed groups are known from this branch, including right neighbor.
    const removed = groups.filter(m => !base.state.monsters.find(n => n.id === m.id)?.race)
    const survivors = base.state.monsters.filter(m => m.race)
    let contexts: EvaluationContext[] = [branchContext]
    for (const persistent of persistentCardsIn(loadout)) {
      const trigger = persistent.onRemovalQuantityBonus
      if (!trigger) continue
      const condition = trigger.condition
      const eligible = !condition || (condition.type === 'minRaceGroups' &&
        groups.filter(m => m.race === condition.target).length >= condition.value)
      if (!eligible) continue
      const count = removed.filter(m => m.race !== trigger.excludedRace).length
      if (!count || !survivors.length) continue
      let sequences: string[][] = [[]]
      for (let i = 0; i < count; i++) sequences = sequences.flatMap(s => survivors.map(m => [...s, m.id]))
      contexts = contexts.flatMap(c => sequences.map(ids => ({ ...c,
        observedPersistentTriggerTargetIdsByCardId: { ...c.observedPersistentTriggerTargetIdsByCardId, [persistent.id]: ids },
      })))
    }
    for (const observed of contexts) outcomes.push(evaluate(variant, observed))
  }
  const id = primary?.id
  if (card.projection === 'egg') {
    const base = source.newbornSwarm!
    for (const count of [1, 3]) {
      const newIds = source.monsters.filter(m=>!m.race).slice(0,count).map(m=>m.id)
      let observations: EvaluationContext[] = [context]
      for (const item of persistentCardsIn(loadout).filter(c=>c.onAddGroupExpectedMutation)) {
        const subsets = Array.from({length:newIds.length+1},(_,i)=>combinations(newIds,i)).flat()
        observations = observations.flatMap(c=>subsets.map(ids=>({...c,
          observedAddedGroupMutationIdsByCardId:{...c.observedAddedGroupMutationIdsByCardId,[item.id]:ids}})))
      }
      for (const observation of observations) run([{ type: 'addGroup', race: 'swarm', rarity: base.rarity, base, count }], observation)
    }
    notes.push('使用你确认的新蛊虫基础属性，覆盖添加1组/3组两个50%分支和六槽容量；不把平均组数写入局面。')
  } else if (!primary || !id) run([])
  else if (card.projection === 'randomRareMutation' || card.projection === 'randomMagicMutation') {
    const selected = groups.filter(m => context.selectedMonsterIds?.includes(m.id))
    let branches: CardEffect[][] = [[]]
    for (const m of selected) {
      const observed = context.observedRaceByMonsterId?.[m.id]
      const possibilities = observed && raceIds.includes(observed) ? [observed] : raceIds
      branches = branches.flatMap(effects => possibilities.map(race => [...effects,
      on([m.id], card.projection === 'randomRareMutation'
        ? [quantity(52), mutate(race), { type: 'setRarity', target: 'selected', rarity: 'rare', allowDowngrade: true }]
        : [mutate(race), { type: 'setRarity', target: 'selected', rarity: 'magic', allowDowngrade: true }, activity(31)]),
      ]))
    }
    for (const effects of branches) run(effects)
    notes.push('枚举所选每组的四种群组合，不把随机种群当作可选择，也不将组合出现次数当作概率。稀有度变化未擅加基础活性；首领不降阶。')
  } else if (card.projection === 'cleansing') {
    run([on([id], [activity(20), ...(primary.race === 'construct'
      ? [quantity(41), { type: 'removeRightOfSelected' } as CardEffect] : [])])])
  } else if (card.projection === 'lowestBoost') {
    const minimum = Math.min(...groups.map(m => m.quantity * m.unitActivity))
    for (const m of groups.filter(m => m.quantity * m.unitActivity === minimum)) run([on([m.id], [activity(42), quantity(42)])])
  } else if (card.projection === 'compound') {
    // Rarity is unchanged; apply bonuses based on each group's original rarity.
    run(groups.map(m => on([m.id], [mutate('aberrant'), activity(m.rarity === 'magic' ? 22 : 11),
      ...(['rare', 'boss'].includes(m.rarity) ? [quantity(11)] : [])])))
  } else if (card.projection === 'seriesMutation') {
    const swarm = card.name.includes('寄生')
    const amount = swarm ? card.name.includes('子一代') ? 10 : card.name.includes('子二代') ? 20 : 30 : 333
    run([on([id], [mutate(swarm ? 'swarm' : 'aberrant'), card.name.includes('育雏') ? quantity(amount) : activity(amount)])])
    notes.push('仅计算本张即时效果；后续特殊发牌不折算活性，不混入普通重抽池。')
  } else if (card.projection === 'seriesRemoval') {
    if (!groups.some(m => m.race === 'construct')) run([])
    else {
      const removedRace = card.name.includes('除虫') ? 'swarm' : card.name.includes('驱魔') ? 'aberrant' : 'awakened'
      run([...groups.filter(m => m.race === removedRace).map(m => on([m.id], [{ type: 'removeRace', target: 'selected' }])),
        on(groups.filter(m => m.race !== removedRace).map(m => m.id),
          [card.name.includes('驱魔') ? activity(199) : quantity(199)])])
    }
    notes.push('仅计算即时移除、增益和已支持常驻；下一轮特殊发牌交由F8识别，不将其估成额外活性。')
  } else if (card.projection === 'boneOil' || card.projection === 'peat') {
    const pool = groups.filter(m => m.race !== 'construct')
    if (!groups.some(m => m.race === 'construct')) run([])
    else {
      const counts = card.projection === 'peat' ? [pool.length] : Array.from({length:Math.min(3,pool.length)+1}, (_,i)=>i)
      for (const count of counts) for (const removed of combinations(pool, count)) {
        const survivors = groups.filter(m => !removed.some(n => n.id === m.id))
        run([...removed.map(m => on([m.id], [{ type: 'removeRace', target: 'selected' }])),
          on(survivors.map(m => m.id), [activity((card.projection === 'peat' ? 20 : 28) * count),
            quantity((card.projection === 'peat' ? 39 : 28) * count)])])
      }
    }
    if (card.projection === 'boneOil') notes.push('至多3组的实际移除数量分布未知，覆盖0至3组；所有移除损失和已支持常驻均计入。')
  } else if (card.projection === 'leechRace' || card.projection === 'leechRarity') {
    const pool = groups.filter(m => card.projection === 'leechRace' ? m.race === primary.race : m.rarity === primary.rarity)
    if (pool.length < 2) {
      run([])
      notes.push('同类不足2组：覆盖不生效与现有目标部分生效两种解释，需实测缩小范围。')
    }
    for (const pair of combinations(pool, Math.min(2, pool.length))) run([on(pair.map(m => m.id), [activity(31)])])
    notes.push('所选怪物只确定种群/稀有度；受益者按所有两组组合比较，不假定能指定第二组或必含所选组。')
  } else if (card.projection === 'exorcise') {
    const removable = groups.filter(m=>m.race !== primary.race)
    for (const victim of removable) run([on([id],[quantity(127)]),on([victim.id],[{type:'removeRace',target:'selected'}])])
    if (!removable.length) { run([]); run([on([id],[quantity(127)])]) }
    notes.push('无不同种群可移除时，覆盖无效和仅增量两个分支，不将强效版本的实测直接套用。')
  } else if (card.projection === 'birthBone') {
    if (primary.race !== 'construct') run([on([id], [quantity(40)])])
    else {
      const removable = groups.filter(m => m.race !== 'construct')
      for (const victim of removable) run([on([id], [quantity(167)]), on([victim.id], [{ type: 'removeRace', target: 'selected' }])])
      if (!removable.length) {
        run([on([id], [quantity(40)])]); run([on([id], [quantity(167)])])
        notes.push('无非骨卫兵可移除：额外+127是否仍生效待确认，覆盖两个分支。')
      }
    }
  } else if (card.projection === 'aberrantAnesthetic') {
    const first = on([id], [mutate('aberrant')])
    run([first])
    for (const second of groups) run([first, on([second.id], [mutate('aberrant')])])
    notes.push('第二次变异概率50%；落点分布未知，显示失败/成功各落点的范围，而非均匀概率期望。')
  } else if (card.projection === 'hollowSpinal') {
    run([on([id], [activity(41)])])
    run([on([id], [activity(41), mutate('aberrant')])])
    notes.push('50%变异分支均已覆盖；随机异魔名字不影响当前种群/稀有度模型。')
  } else if (card.projection === 'graySpinal') {
    for (const race of raceIds) {
      const first = on([id], [activity(41), mutate(race)])
      run([first]); run([first, on([id], [mutate('aberrant'), activity(30)])])
    }
    notes.push('覆盖四种群首次变异及50%再次变异分支；名字及首次变异种群分布未知，不假设均匀。')
  } else if (card.projection === 'freshSpinal') {
    const pool = groups.filter(m => m.race !== 'aberrant')
    for (let count = 0; count <= Math.min(3, pool.length); count++) {
      for (const changed of combinations(pool, count)) {
        const changedIds = changed.map(m => m.id)
        const conversion = on(changedIds, [{ ...mutate('aberrant'), onlyIfDifferent: true } as CardEffect])
        const eligible = groups.filter(m => m.race === 'aberrant' || changedIds.includes(m.id))
        if (!count) { run([]); continue }
        // Include no quantity gain when fewer than 3 recipients: unresolved shortfall.
        if (eligible.length < 3) run([conversion])
        // Repeating one recipient set gives a conservative envelope of allocations.
        // Scores include existing supported mutation bonuses, not assumed random weights.
        for (const recipients of combinations(eligible, Math.min(3, eligible.length))) {
          run([conversion, on(recipients.map(m => m.id), [quantity(42 * count)])])
        }
      }
    }
    notes.push('“至多3组”命中数未确认，覆盖0至3组；加数量按最终异魔集合给出外包范围，兼容分步/批量变异，非精确随机期望。')
    notes.push('每次最多3个不同受益组，不假设同一次重复命中；不足3组同时覆盖部分生效和不生效，待实测确认。')
  }
  if (!outcomes.length) run([])
  outcomes.sort((a, b) => a.score - b.score || a.delta - b.delta)
  const minimum = Math.min(...outcomes.map(r => r.activityAfter))
  const maximum = Math.max(...outcomes.map(r => r.activityAfter))
  return { ...outcomes[0], card, scoreLabel: `保守${outcomes[0].scoreLabel}`,
    modelUnavailable: outcomes.find(r=>r.modelUnavailable)?.modelUnavailable,
    raceGroupRange: raceRanges(outcomes),
    activityRange: { minimum, maximum },
    trace: [`已计算${outcomes.length}个分支端点；总活性范围 ${minimum}–${maximum}，不是确定结算结果。`, ...notes,
      ...(outcomes.length === 1 ? outcomes[0].trace : [])],
    analysis: [...outcomes[0].analysis, '游戏选择后按F8同步；不将保守分支写回真实局面。'],
    warnings: [...new Set(outcomes.flatMap(r => r.warnings))],
  }
}
