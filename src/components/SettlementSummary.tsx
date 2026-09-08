import type { EvaluationResult } from '../types/game'

/** Display the engine preview, never store a second copy of projected monsters. */
export function SettlementSummary({ result }: { result: EvaluationResult }) {
  const settlement = result.settlement
  if (!settlement) return null
  if (settlement.unavailable) return <div className="settlement-summary">
    <strong>药剂/常驻结算缺少数据</strong><p>{settlement.unavailable}</p>
    <small>当前不能计算完整收益；请补充参数或在游戏操作后按 F8 校准。</small>
  </div>
  return <div className="settlement-summary">
    <div>药剂即时变化：{result.delta >= 0 ? '+' : ''}{result.delta}</div>
    <div className={settlement.change < 0 ? 'negative' : 'positive'}>
      常驻结算增减：{settlement.change >= 0 ? '+' : ''}{settlement.change}
    </div>
    <div>本轮结束投射：{settlement.projectedActivity}</div>
    <small>常驻事件链预览；随机分支较多时使用抽样最小值，不代表实际保底</small>
    {settlement.details.some(line => line.includes('独立投射')) &&
      <small>多常驻顺序连锁尚未完整量化，仅供参考。</small>}
    <details><summary>常驻计算依据</summary>
      {settlement.details.map((line, index) => <div key={index}>{line}</div>)}
    </details>
  </div>
}
