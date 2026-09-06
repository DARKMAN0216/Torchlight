import type { RaceId } from '../types/game'

/** Opening hint metadata ONLY. Not trigger eligibility, scoring, or effect evaluation.
 * An empty list explicitly means no specific race association; missing means unknown.
 * Associations include a card's named race route, even when it produces that race or
 * removes OTHER races (contracted claw). They do not imply an effect cannot activate.
 */
export const openingCardRaces: Readonly<Record<string, readonly RaceId[]>> = {
  人蛹标本: ['swarm'],
  孵化囊: ['swarm'],
  增生前额叶: ['awakened'],
  肿大脑垂体: ['awakened'],
  粘连跖骨: ['construct'],
  挛缩指爪: ['construct'],
  孽生肉芽: ['aberrant'],
  斑斓肝脏: ['aberrant'],
  簇生虫卵: ['swarm'],
  蜕生脑皮层: ['awakened'],
  兽筋绞肉索: ['construct'],
  蠕动脊髓: ['aberrant'],
  生皮革拘束带: [],
  黑山羊肠缝线: [],
  生铁骨锯: [],
  二寸颅骨钉: [],
  脏污刮骨刀: [],
  犬牙锉刀: [],
  疫区圣母像: [],
  异形蛰针: [],
  鞣制皮革拘束带: [],
  眼睑扩张器: [],
  二度降生者之喙: [],
  荨麻绳扣: [],
}

const knownAliases: Readonly<Record<string, string>> = {
  蔓生肉芽: '孽生肉芽',
  梳造骸骨: '粘连跖骨',
  粘造骸骨: '粘连跖骨',
}

export function openingRacesForName(name: string): readonly RaceId[] | undefined {
  const normalized = name.normalize('NFKC').replace(/\s+/g, '')
  const canonical = Object.hasOwn(knownAliases, normalized) ? knownAliases[normalized] : normalized
  return Object.hasOwn(openingCardRaces, canonical) ? openingCardRaces[canonical] : undefined
}
