import type { PersistentChoiceEvaluation } from '../engine/persistentChoice'
import type { PersistentOffer } from '../recognition/merge'

export function PersistentRecommendation({ offers, ranking }: {
  offers: PersistentOffer[]
  ranking: PersistentChoiceEvaluation[]
}) {
  const best = ranking[0]
  const missing = offers.filter((offer) => !offer.cardId)
  const tied = best ? ranking.filter((item) => item.score === best.score && item.nextRoundEndBonus === best.nextRoundEndBonus) : []
  return (
    <div className="floating-recommendation">
      <span>{missing.length ? '已入库常驻中的参考推荐' : '常驻手术用具推荐'}</span>
      {best ? <>
        <strong>{tied.map((item) => item.card.name).join(' / ')}</strong>
        <b>后续战略评分 {best.scoreDelta >= 0 ? '+' : ''}{Math.round(best.scoreDelta)}</b>
        <p>{tied.length > 1 ? '当前已确认收益并列，暂不能区分优劣。' : best.card.description}</p>
        {best.card.modelWarning && <p>{best.card.modelWarning}</p>}
        {best.card.roundEndQuantityPerRaceGroup && best.analysis.filter(line => line.startsWith(`${best.card.name}：`)).map(line => <p key={line}>{line}</p>)}
        <p>战略评分包含路线启发式，不代表未来活性的精确期望。</p>
        <p>从后续回合生效；展开完整界面可确认追加。</p>
      </> : <strong>暂不能推荐：这批常驻尚未匹配入库</strong>}
      {missing.length > 0 && <p>未匹配：{missing.map((offer) => offer.name).join('、')}。不能据此判断全部三张的最优解。</p>}
    </div>
  )
}
