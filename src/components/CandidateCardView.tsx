import type { CandidateCard, EvaluationResult } from '../types/game'
import { synchronizationCopy } from '../recognition/followState'
import { SettlementSummary } from './SettlementSummary'

interface CandidateCardViewProps {
  slotIndex: number
  card: CandidateCard
  cards: CandidateCard[]
  result?: EvaluationResult
  recommended: boolean
  pending: boolean
  disabled: boolean
  following?: boolean
  onCardChange: (id: string) => void
  onApply: () => void
}

export function CandidateCardView({
  slotIndex,
  card,
  cards,
  result,
  recommended,
  pending,
  disabled,
  following = false,
  onCardChange,
  onApply,
}: CandidateCardViewProps) {
  return (
    <article className={`candidate-card rarity-${card.rarity} ${recommended ? 'recommended' : ''} ${pending ? 'pending' : ''}`}>
      <div className="card-topline">
        <span className="rarity-marker">{card.rarity}</span>
        {recommended && <span className="recommend-flag">推荐</span>}
      </div>
      <label className="sr-only" htmlFor={`card-slot-${slotIndex}`}>
        第 {slotIndex + 1} 张候选卡
      </label>
      <select
        id={`card-slot-${slotIndex}`}
        className="card-select"
        disabled={disabled}
        value={card.id}
        onChange={(event) => onCardChange(event.target.value)}
      >
        {cards.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <div className="card-tags">{synchronizationCopy(card.tags.join(' · '), following)}</div>
      <p className="card-description">{card.description}</p>
      <div className="card-rule" />
      {result ? <><div className="card-metric">
        <span>{result.scoreLabel}变化</span>
        <strong className={result.scoreDelta >= 0 ? 'positive' : 'negative'}>
          {result.scoreDelta >= 0 ? '+' : ''}{result.scoreDelta}
        </strong>
      </div>
      <div className="card-total">
        <span>{result.activityRange ? '预计总活性范围' : '选择后活性'}</span>
        <strong>{result.activityRange ? `${result.activityRange.minimum}–${result.activityRange.maximum}` : result.activityAfter}</strong>
      </div>
      <SettlementSummary result={result} />
      </> : <div className="card-metric"><span>已收录 · 尚未量化</span><strong>待确认</strong>
        {card.requiresNewbornSwarm && <p>请在设置中确认新蛊虫基础属性后计算。</p>}</div>}
      {card.targeting && (
        <div className="card-target-note">
          {result?.recommendedTargetIds?.length
            ? `建议目标：${result.recommendedTargetIds.map((id) => id.replace('slot-', '槽位 ')).join('、')}`
            : card.targeting.mode === 'observedRandom'
              ? following ? '随机结果将自动读取' : '需记录随机命中目标'
              : `需选择 ${card.targeting.minTargets}–${card.targeting.maxTargets} 个目标`}
        </div>
      )}
      {result && result.warnings.length > 0 && (!card.targeting || pending) && (
        <div className="card-warning">{result.warnings.join('，')}</div>
      )}
      {card.modelCoverage && card.modelCoverage !== 'confirmed' && (
        <div className="card-warning">
          {card.modelCoverage === 'partial' ? '部分建模' : '规则待确认'}：{synchronizationCopy(card.modelWarning ?? '', following)}
        </div>
      )}
      <button className="card-apply-button" type="button" disabled={disabled || card.evaluationUnavailable || card.requiresScreenSync} onClick={onApply}>
        {following ? '在游戏使用后自动同步' : card.evaluationUnavailable || card.requiresScreenSync ? '游戏使用后按 F8 同步' : disabled
          ? '等待回合结束结算'
          : card.followUpOfferCount
            ? `展开 ${card.followUpOfferCount} 张药剂`
          : card.targeting
            ? '选择目标并结算'
            : '选择并结算'}
      </button>
    </article>
  )
}
