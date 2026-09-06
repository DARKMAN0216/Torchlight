import type { CandidateCard, EvaluationResult, GameState, PersistentLoadout } from '../types/game'
import { raceLabels } from '../data/sampleLibrary'
import { replacementExploration, startupNeed } from '../engine/startup'

/** Derived from the current board/loadout only; never retained across F8 or card choices. */
export function StartupAdvice({ state, loadout, cards, ranking, compact = false }: {
  state: GameState; loadout: PersistentLoadout; cards: CandidateCard[]; ranking: EvaluationResult[]; compact?: boolean
}) {
  const need = startupNeed(state, loadout)
  if (!need) return null
  const race = raceLabels[need.race]
  const paths = ranking.filter(r => r.startup?.maximumGroups)
  const unknown = cards.flatMap(card => {
    const plan = replacementExploration(state, card, need.race)
    return plan ? [{ card, plan }] : []
  })
  const preferred = paths.find(r => r.startup?.safeForPriority)
  return <section className="startup-advice" aria-label="常驻启动路线">
    <h3>当前目标：先获得{race}，启动{need.passiveNames.join('、')}</h3>
    <p>{compact ? '启动路线是策略偏好，不是未来收益期望。' : state.mode === 'strategic'
      ? '启动优先是策略偏好：优先无已知净损失的确定启动，再考虑能保留更多目标种群的随机路线；不是未来活性期望。'
      : '当前按数值收益排序；切换“常驻协同”才采用启动优先策略。'}</p>
    {preferred && <strong>{state.mode === 'strategic' ? '启动路线首选' : '启动路线参考'}：{preferred.card.name}</strong>}
    {unknown.map(({card, plan}) => <p key={card.id}>探索备选：{card.name}（移除损失 {plan.removedActivity}，最多新增 {plan.opportunities} 组；净收益未知）</p>)}
    <details><summary>启动路径、随机风险与移除代价{unknown.length ? '（含未量化备选）' : ''}</summary>
    <ul>{paths.map(result => <li key={result.card.id}>
      <b>{result.card.name}</b>：药剂结算后可能有 {result.startup!.minimumGroups}–{result.startup!.maximumGroups} 组{race}。
      {result.recommendedTargetIds?.length ? `建议选择${result.recommendedTargetIds.map(id => id.replace('slot-', '槽 ')).join('、')}。` : ''}
      {result.card.projection === 'graySpinal' ? '首次也可能变为蛊虫，但后续50%再次变异为异魔可能使其丢失，不能算稳定启动。' : ''}
      {!result.startup!.safeForPriority ? '存在即时或常驻净损失，不自动优先；请权衡代价。' : ''}
    </li>)}{unknown.map(({ card, plan }) => <li key={card.id}>
      <b>探索备选：{card.name}</b>。优先保留高活性怪物，可移除{plan.ids.map(id => id.replace('slot-', '槽 ')).join('、')}，先损失 {plan.removedActivity} 活性；按空槽容量最多新增 {plan.opportunities} 组随机怪物，有机会获得{race}。
      新怪基础属性和种群概率未知，不保证出现{race}，净收益未知，不计入数值排名；其他常驻的移除/添加连锁需另行核对。
    </li>)}</ul>
    {!paths.length && !unknown.length && <p>本次没有已知的启动路径；不要把无关加成当作已解决常驻缺口，可考虑药箱或手动洗牌。</p>}
    <small>0–N 是可能的组数范围，不是命中率；不假设各种群等概率，也不预知之后发什么牌。已有目标种群或进入第10回合后取消此启动提示。</small>
    </details>
  </section>
}
