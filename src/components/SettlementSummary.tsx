import type { EvaluationResult } from '../types/game'

/** Display the engine preview, never store a second copy of projected monsters. */
export function SettlementSummary({ result }: { result: EvaluationResult }) {
  const settlement = result.settlement
  if (!settlement) return null
  return <div className="settlement-summary">
    <div>药剂即时变化：{result.delta >= 0 ? '+' : ''}{result.delta}</div>
    <div className={settlement.change < 0 ? 'negative' : 'positive'}>
      常驻结算增减：{settlement.change >= 0 ? '+' : ''}{settlement.change}
    </div>
    <div>本轮结束投射：{settlement.projectedActivity}</div>
    <small>含已建模常驻；随机效果按保守值，非实际结算</small>
    {settlement.details.some(line => line.includes('独立投射')) &&
      <small>多常驻顺序连锁尚未完整量化，仅供参考。</small>}
    <details><summary>常驻计算依据</summary>
      {settlement.details.map((line, index) => <div key={index}>{line}</div>)}
    </details>
  </div>
}
