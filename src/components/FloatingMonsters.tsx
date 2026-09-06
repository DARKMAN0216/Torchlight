import { raceLabels, rarityLabels } from '../data/sampleLibrary'
import type { EvaluationResult, GameState } from '../types/game'
import type { RecognitionSnapshot } from '../recognition/contracts'

export function floatingTargets(state: GameState, result?: EvaluationResult) {
  if (!result || state.recognitionReview?.length) return { ids: [], description: '暂无可靠目标推荐' }
  const targeting = result.card.targeting
  if (targeting?.mode === 'observedRandom') return { ids: [], description: '随机命中，不能指定怪物；结果出现后再识别' }
  if (!targeting) return { ids: [], description: '无需手动指定怪物' }
  const ids = result.recommendedTargetIds ?? []
  const targets = state.monsters.flatMap((monster, index) => ids.includes(monster.id) && monster.race && monster.quantity > 0
    ? [`槽 ${index + 1} · ${raceLabels[monster.race]} / ${rarityLabels[monster.rarity]}`] : [])
  if (targets.length !== ids.length || !ids.length) return { ids: [], description: '目标尚未确定，请展开完整界面核对' }
  return { ids, description: `选择：${targets.join('；')}` }
}

export function FloatingMonsters({ state, result, snapshot }: {
  state: GameState; result?: EvaluationResult; snapshot?: RecognitionSnapshot | null
}) {
  const targets = floatingTargets(state, result)
  return <section className="floating-monsters" aria-label="六槽怪物信息">
    <div className="floating-monster-heading"><strong>怪物 · 从左到右</strong><span>{state.recognitionReview?.length ? '保留值，待核对' : '单体活性 × 数量'}</span></div>
    <ol>
      {state.monsters.map((monster, index) => {
        const occupied = monster.race !== null && monster.quantity > 0
        const selected = targets.ids.includes(monster.id)
        const name = snapshot?.monsterSlots?.find((slot) => slot.slotId === monster.id)?.name
        return <li key={monster.id} className={`${selected ? 'recommended-target' : ''} ${occupied ? '' : 'empty-slot'}`}>
          <span className="floating-slot">{selected ? '✓' : '·'} {index + 1}</span>
          <div className="floating-monster-name"><strong>{occupied ? raceLabels[monster.race!] : '空槽'}</strong>{occupied && name && name.confidence >= .85 && <small>{name.value}</small>}</div>
          <span className={`floating-rarity rarity-${monster.rarity}`}>{occupied ? rarityLabels[monster.rarity] : '—'}</span>
          <div className="floating-monster-value">{occupied ? `${monster.unitActivity} × ${monster.quantity}` : '—'}{occupied && <small>= {(monster.unitActivity * monster.quantity).toLocaleString()}</small>}</div>
        </li>
      })}
    </ol>
    {result && <p className="floating-target-description">{targets.description}</p>}
  </section>
}
