import type { EvaluationResult } from '../types/game'
import { WarningIcon } from './Icons'
import { synchronizationCopy } from '../recognition/followState'
import { SettlementSummary } from './SettlementSummary'

interface RecommendationPanelProps {
  ranking: EvaluationResult[]
  onApply: () => void
  disabled?: boolean
  coverageWarning?: string
  following?: boolean
}

export function RecommendationPanel({ ranking, onApply, disabled = false, coverageWarning = '', following = false }: RecommendationPanelProps) {
  const best = ranking[0]
  if (!best) return null
  const incompleteCards = ranking.filter((item) =>
    item.card.modelCoverage && item.card.modelCoverage !== 'confirmed',
  )
  const isConservativeRecommendation = incompleteCards.length > 0 || Boolean(coverageWarning)
  const startupPriority = best.state.mode === 'strategic' && best.startup?.safeForPriority

  return (
    <aside className="panel recommendation-panel">
      <div className="panel-heading">
        <div>
          <h2>推荐结果</h2>
          <p>{startupPriority ? '常驻启动优先 · 策略偏好，非最高活性期望' : isConservativeRecommendation
            ? '基于已确认效果的保守最优'
            : '基于当前状态的局部最优'}</p>
        </div>
      </div>

      <div className="recommendation-hero">
        {coverageWarning && <p>{coverageWarning}</p>}
        <span>{startupPriority ? '启动路线首选' : '推荐卡牌'}</span>
        <h3>{best.card.name}</h3>
        <div className="hero-score">
          <small>{best.scoreLabel}变化</small>
          <strong>{best.scoreDelta >= 0 ? '+' : ''}{best.scoreDelta}</strong>
        </div>
        <div className="hero-projected">
          {best.activityRange ? '预计总活性范围' : '选择后总活性'} <b>{best.activityRange ? `${best.activityRange.minimum}–${best.activityRange.maximum}` : best.activityAfter}</b>
        </div>
        <SettlementSummary result={best} />
        <button className="primary-button" type="button" disabled={disabled || best.card.requiresScreenSync} onClick={onApply}>
          {following ? '在游戏使用后自动同步' : best.card.requiresScreenSync ? '游戏使用后按 F8 同步' : disabled
            ? '请先结算回合结束效果'
            : best.card.followUpOfferCount
              ? `展开 ${best.card.followUpOfferCount} 张药剂`
            : best.card.targeting
              ? '选择目标并应用推荐'
              : '应用推荐到局面'}
        </button>
      </div>

      <section className="explanation-block">
        <h3>计算说明</h3>
        <ul>
          {best.trace.length + best.analysis.length > 0 ? (
            [...best.trace, ...best.analysis].map((item, index) => <li key={`${item}-${index}`}>{synchronizationCopy(item, following)}</li>)
          ) : (
            <li>该卡在当前状态下没有触发生效规则。</li>
          )}
        </ul>
      </section>

      <section className="ranking-block">
        <h3>{startupPriority ? '策略顺序（右侧仍为数值评分）' : '备选排名'}</h3>
        <ol>
          {ranking.map((item, index) => (
            <li key={`${index}-${item.card.id}`} className={index === 0 ? 'rank-first' : ''}>
              <span className="rank-index">{index + 1}</span>
              <span className="rank-name">{item.card.name}</span>
              <strong>{item.scoreDelta >= 0 ? '+' : ''}{item.scoreDelta}</strong>
            </li>
          ))}
        </ol>
      </section>

      <div className="notice-box">
        <WarningIcon />
        <div>
          <strong>{best.scoreLabel === '战略评分' ? '实验性战略模型' : '示例规则库'}</strong>
          <p>{coverageWarning || (isConservativeRecommendation
            ? `本轮含未完整建模卡牌：${incompleteCards.map((item) => item.card.name).join('、')}。当前推荐只比较已确认收益，不代表未知机制全部揭示后的全信息最优。`
            : best.scoreLabel === '战略评分'
              ? '把当前活性、阵容完整度、稀有度潜力、常驻卡成型条件与可确认的回合结束转移收益合并评分；权重仍需实战校准。'
              : '当前卡名与数值用于验证软件流程，尚不是完整游戏卡库。')}</p>
        </div>
      </div>
    </aside>
  )
}
