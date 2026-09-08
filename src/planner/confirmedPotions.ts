import type { CardDefinition } from './types'
import { specialPotions } from './specialPotions'

/** User calibration, 2026-09-08. Stable legacy IDs are intentionally preserved. */
export const confirmedPotions: CardDefinition[] = [
  ...specialPotions,
  { id: 'twin-hormone-swarm', name: '孪生激素-蛊虫', targeting: { mode: 'choose', min: 1, max: 1 },
    effects: [{ type: 'confirmedPotion', kind: 'twinSwarm' }] },
  { id: 'catalog-魔法药剂:通用:2', name: '卵壳药粉', targeting: { mode: 'random', min: 1, max: 1 },
    effects: [{ type: 'confirmedPotion', kind: 'eggshell' }] },
  { id: 'catalog-魔法药剂:通用:16', name: '黏稠胆汁溶液', targeting: { mode: 'choose', min: 1, max: 1 },
    effects: [{ type: 'confirmedPotion', kind: 'viscousBile' }] },
  { id: 'molting-skin-solution', name: '蜕生皮溶液', targeting: { mode: 'choose', min: 2, max: 2 },
    effects: [{ type: 'confirmedPotion', kind: 'swarmFusion' }] },
  { id: 'catalog-普通药剂:通用:9', name: '异种激素', targeting: { mode: 'choose', min: 1, max: 2 },
    effects: [{ type: 'confirmedPotion', kind: 'xeno' }] },
  { id: 'catalog-至臻药剂:通用:4', name: '诱虫剂',
    effects: [{ type: 'confirmedPotion', kind: 'insectLure' }] },
  { id: 'active-oviposition-hormone', name: '活性育卵激素',
    effects: [{ type: 'confirmedPotion', kind: 'oviposition' }] },
]
