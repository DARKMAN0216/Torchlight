import { describe, expect, it } from 'vitest'
import {
  realCardCatalog,
  realCardCategoryCounts,
  realCardCategories,
} from './realCardCatalog'

describe('真实卡牌目录', () => {
  it('解析出文档声明的 84 张卡牌', () => {
    expect(realCardCatalog).toHaveLength(84)
    expect(new Set(realCardCatalog.map((card) => card.id)).size).toBe(84)
  })

  it('分类数量与统计总览一致', () => {
    expect(realCardCategoryCounts).toEqual({
      手术用具: 24,
      普通药剂: 10,
      魔法药剂: 16,
      稀有药剂: 7,
      药剂箱: 3,
      至臻药剂: 5,
      特殊药剂: 19,
    })
    expect(Object.keys(realCardCategoryCounts)).toEqual([...realCardCategories])
  })

  it('保留卡名、目标方式、分组与原始效果文字', () => {
    const targeted = realCardCatalog.find((card) => card.name === '消化酶溶液')
    expect(targeted?.poolOrTarget).toBe('选择 1 组')
    expect(targeted?.effectText).toContain('左侧怪物')
    expect(targeted?.mechanicTags).toContain('位置相关')

    const special = realCardCatalog.find((card) => card.name === '异种万灵药：壮骨')
    expect(special?.subgroup).toBe('异魔特殊药剂')
  })
})
