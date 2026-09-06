import type { GameState, PersistentCard } from '../types/game'

/** Exact envelope under the two documented repetition interpretations and both
 * settlement orders. No probability distribution or game ordering is invented.
 * With X distinct recipients per repetition, integer hit counts satisfy
 * sum(hits)=X*repetitions, 0<=hits<=repetitions (uniform row-degree allocation).
 */
export function projectPupaScraper(state: GameState, pupa: PersistentCard, scraper: PersistentCard) {
  const rule = pupa.roundEndQuantityPerRaceGroup
  const effect = scraper.roundEndEffect?.effects[0]
  if (!rule || scraper.roundEndEffect?.effects.length !== 1 || !effect ||
    effect.type !== 'addActivity' || effect.target !== 'all' || !effect.allMatches ||
    effect.minQuantityExclusive === undefined || effect.condition || effect.repeatByRarity ||
    effect.repeatPerRaceGroup || effect.repeatOnlyRace || effect.perUnit) return undefined
  const groups = state.monsters.filter(item => item.race && item.quantity > 0)
  const x = groups.filter(item => item.race === rule.race).length
  const before = groups.reduce((sum, item) => sum + item.quantity * item.unitActivity, 0)
  let minimum = Infinity, maximum = -Infinity
  let allocations = 0
  const hits = new Array<number>(groups.length).fill(0)
  const inspect = () => {
    allocations++
    for (const pupaFirst of [false, true]) {
      const after = groups.reduce((sum, item, i) => {
        const quantity = item.quantity + hits[i] * rule.amount
        const eligible = (pupaFirst ? quantity : item.quantity) > effect.minQuantityExclusive!
        return sum + quantity * (item.unitActivity + (eligible ? effect.amount : 0))
      }, 0)
      minimum = Math.min(minimum, after - before)
      maximum = Math.max(maximum, after - before)
    }
  }
  for (const repetitions of x ? [x, x + 1] : [0]) {
    const walk = (index: number, remaining: number) => {
      if (index === groups.length) { if (!remaining) inspect(); return }
      const lower = Math.max(0, remaining - (groups.length - index - 1) * repetitions)
      for (let value = lower; value <= Math.min(repetitions, remaining); value++) {
        hits[index] = value
        walk(index + 1, remaining - value)
      }
    }
    walk(0, x * repetitions)
  }
  return {
    bonus: minimum, activityBonus: minimum,
    analysis: [
      `${pupa.name} × ${scraper.name}：X=${x}，穷举 ${allocations} 种数量分配及两种结算顺序，回合结束活性范围 +${minimum}–+${maximum}；按下界评分。`,
      '已重算数量大于275的触发门槛与活性×数量交叉收益；顺序/重复次数/随机概率待实测，不写回投射局面。',
    ],
  }
}
