import { useEffect, useMemo, useState } from 'react'
import {
  realCardCatalog,
  realCardCategories,
  realCardCategoryCounts,
  type RealCardCategory,
} from '../data/realCardCatalog'

interface CardCatalogDialogProps {
  onClose: () => void
}

export function CardCatalogDialog({ onClose }: CardCatalogDialogProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<RealCardCategory | '全部'>('全部')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const filteredCards = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    return realCardCatalog.filter((card) => {
      const inCategory = category === '全部' || card.category === category
      const haystack = [
        card.name,
        card.category,
        card.subgroup,
        card.poolOrTarget,
        card.effectText,
      ].join(' ').toLocaleLowerCase('zh-CN')
      return inCategory && (!keyword || haystack.includes(keyword))
    })
  }, [category, query])

  return (
    <div className="catalog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="catalog-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
      >
        <header className="catalog-header">
          <div>
            <h2 id="catalog-title">真实卡牌库</h2>
            <p>已从用户统计表无损载入 84 张；数值以文档的 SS11 底表口径为主。</p>
          </div>
          <button type="button" className="catalog-close" onClick={onClose}>关闭</button>
        </header>

        <div className="catalog-warning">
          <strong>当前仅作为资料目录</strong>
          <span>正式计算仍需六个独立怪物槽、稀有度、位置、目标选择及随机分支模型。</span>
        </div>

        <div className="catalog-controls">
          <label>
            <span>搜索卡名或效果</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：蛊虫、移除、下一轮"
              autoFocus
            />
          </label>
          <label>
            <span>卡牌类别</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as RealCardCategory | '全部')}
            >
              <option value="全部">全部 · 84</option>
              {realCardCategories.map((item) => (
                <option value={item} key={item}>{item} · {realCardCategoryCounts[item]}</option>
              ))}
            </select>
          </label>
          <div className="catalog-result-count" aria-live="polite">
            当前显示 <strong>{filteredCards.length}</strong> 张
          </div>
        </div>

        <div className="catalog-list" role="list">
          {filteredCards.map((card) => (
            <article className="catalog-row" role="listitem" key={card.id}>
              <div className="catalog-card-identity">
                <span>{card.category}{card.subgroup ? ` · ${card.subgroup}` : ''}</span>
                <h3>{card.name}</h3>
                {card.poolOrTarget && <small>{card.poolOrTarget}</small>}
              </div>
              <p>{card.effectText}</p>
              <div className="mechanic-tags" aria-label="机制要求">
                {card.mechanicTags.length > 0
                  ? card.mechanicTags.map((tag) => <span key={tag}>{tag}</span>)
                  : <span>直接效果</span>}
              </div>
            </article>
          ))}
          {filteredCards.length === 0 && (
            <div className="catalog-empty">没有符合当前筛选条件的卡牌。</div>
          )}
        </div>
      </section>
    </div>
  )
}
