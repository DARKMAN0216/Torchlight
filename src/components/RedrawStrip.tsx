import type { RedrawEstimate } from '../types/game'

interface RedrawStripProps {
  currentBest: number
  scoreLabel: string
  estimate3: RedrawEstimate
  rerollsRemaining: number
  recommended: boolean
  onReroll: () => void
}

function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function RedrawStrip({
  currentBest,
  scoreLabel,
  estimate3,
  rerollsRemaining,
  recommended,
  onReroll,
}: RedrawStripProps) {
  return (
    <section className="redraw-section">
      <div className="section-heading">
        <div>
        <h2>重抽决策 · 仅可计算卡池</h2>
          <p>每局共有 3 次洗牌机会；药剂箱展开不消耗洗牌</p>
        </div>
      </div>
      <div className="redraw-options">
        <div className="redraw-option active">
          <span>保留当前{scoreLabel}</span>
          <strong>{Math.round(currentBest)}</strong>
          <small>确定结果</small>
        </div>
        <button
          type="button"
          className={`redraw-option${recommended ? ' active' : ''}`}
          onClick={onReroll}
          disabled={rerollsRemaining <= 0}
        >
          <span>{recommended ? '建议洗牌 · ' : ''}重抽 3 张</span>
          <strong>{Math.round(estimate3.expectedBest)}</strong>
          <small>
            剩余 {rerollsRemaining}/3 · 超过当前 {formatProbability(estimate3.improveProbability)}
          </small>
        </button>
      </div>
    </section>
  )
}
