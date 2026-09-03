import sourceMarkdown from '../../data/火炬之光无限_渴瘾症_全部卡牌统计.md?raw'

export const realCardCategories = [
  '手术用具',
  '普通药剂',
  '魔法药剂',
  '稀有药剂',
  '药剂箱',
  '至臻药剂',
  '特殊药剂',
] as const

export type RealCardCategory = (typeof realCardCategories)[number]
export type MechanicTag = '选择目标' | '随机结果' | '跨回合' | '位置相关' | '独立怪物组'

export interface RealCardCatalogEntry {
  id: string
  index: number
  name: string
  category: RealCardCategory
  subgroup?: string
  poolOrTarget?: string
  effectText: string
  mechanicTags: MechanicTag[]
}

const sectionMatchers: Array<[RegExp, RealCardCategory]> = [
  [/^## 三、手术用具/, '手术用具'],
  [/^## 四、普通药剂/, '普通药剂'],
  [/^## 五、魔法药剂/, '魔法药剂'],
  [/^## 六、稀有药剂/, '稀有药剂'],
  [/^## 七、药剂箱/, '药剂箱'],
  [/^## 八、至臻药剂/, '至臻药剂'],
  [/^## 九、种群特殊药剂/, '特殊药剂'],
]

function cleanCell(value: string): string {
  return value.replaceAll('**', '').trim()
}

function makeId(category: RealCardCategory, subgroup: string | undefined, index: number) {
  return `${category}:${subgroup ?? '通用'}:${index}`
}

function classifyMechanics(effect: string, poolOrTarget?: string): MechanicTag[] {
  const source = `${poolOrTarget ?? ''} ${effect}`
  const tags: MechanicTag[] = []
  if (/选择|所选/.test(source)) tags.push('选择目标')
  if (/随机|概率/.test(source)) tags.push('随机结果')
  if (/下一轮|每回合|回合结束|每 \d 回合/.test(source)) tags.push('跨回合')
  if (/左侧|右侧/.test(source)) tags.push('位置相关')
  if (/组怪物|1 组|2 组|3 组|4 组|5 组|6 组|所有怪物/.test(source)) {
    tags.push('独立怪物组')
  }
  return tags
}

export function parseRealCardCatalog(markdown: string): RealCardCatalogEntry[] {
  let category: RealCardCategory | undefined
  let subgroup: string | undefined
  const cards: RealCardCatalogEntry[] = []

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('## ')) {
      const matched = sectionMatchers.find(([pattern]) => pattern.test(line))
      category = matched?.[1]
      subgroup = undefined
      continue
    }

    if (category === '特殊药剂' && line.startsWith('### ')) {
      subgroup = line
        .replace(/^###\s+\d+\.\d+\s+/, '')
        .replace(/（\d+ 张）$/, '')
        .trim()
      continue
    }

    if (!category || !/^\|\s*\d+\s*\|/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(cleanCell)
    const index = Number(cells[0])
    const name = cells[1]
    const effectText = cells.at(-1) ?? ''
    const poolOrTarget = cells.length === 4 ? cells[2] : undefined
    cards.push({
      id: makeId(category, subgroup, index),
      index,
      name,
      category,
      subgroup,
      poolOrTarget,
      effectText,
      mechanicTags: classifyMechanics(effectText, poolOrTarget),
    })
  }

  return cards
}

export const realCardCatalog = parseRealCardCatalog(sourceMarkdown)

export const realCardCategoryCounts = Object.fromEntries(
  realCardCategories.map((category) => [
    category,
    realCardCatalog.filter((card) => card.category === category).length,
  ]),
) as Record<RealCardCategory, number>
