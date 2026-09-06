import { raceLabels } from '../data/sampleLibrary'
import { openingRacesForName } from '../data/openingCardRaces'
import { openingRouteMismatch } from '../engine/openingWarning'
import type { GameState } from '../types/game'

export function OpeningWarning({ state, offers }: {
  state: GameState
  offers: readonly { name: string; confidence?: number }[]
}) {
  const mismatch = openingRouteMismatch(state, offers)
  if (!mismatch) return null
  return <div className="opening-mismatch-warning" role="alert">
    <strong>天崩开局</strong>
    <p>场上怪物与三张手术用具关联的种群完全不匹配。</p>
    <p>{offers.map(offer => `${offer.name} → ${openingRacesForName(offer.name)!.map(race => raceLabels[race]).join('、')}`).join('；')}</p>
    <p>仅按卡牌与种群关联提醒，不考虑稀有度、数量门槛或模型评分；不代表所有效果无效。</p>
  </div>
}
