import { useEffect, useMemo, useState } from 'react'
import { candidateCards } from '../data/sampleLibrary'
const modelsByName = new Map(candidateCards.map(card=>[card.name,card]))
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
  const [onlyGaps, setOnlyGaps] = useState(false)

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
      const model = modelsByName.get(card.name)
      if (onlyGaps && (!model || (!model.evaluationUnavailable && !model.requiresNewbornSwarm && model.modelCoverage !== 'partial'))) return false
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
  }, [category, query, onlyGaps])

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
          <strong>名称收录与计算覆盖分开显示</strong>
          <span>范围/部分计算不等于精确期望。仍需规则或参数的卡列出原因；特殊发牌不混入普通重抽池。</span>
        </div>

        <div className="catalog-controls">
          <label><input type="checkbox" checked={onlyGaps} onChange={e=>setOnlyGaps(e.target.checked)} />只看规则/参数缺口与范围模型</label>
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
                {modelsByName.get(card.name) && <small>
                  {modelsByName.get(card.name)!.requiresNewbornSwarm ? '需确认基础参数'
                    : modelsByName.get(card.name)!.evaluationUnavailable ? '待补规则'
                    : modelsByName.get(card.name)!.projection ? '分支范围计算'
                    : modelsByName.get(card.name)!.modelCoverage === 'partial' ? '部分计算' : '已接入计算'}
                </small>}
                {card.poolOrTarget && <small>{card.poolOrTarget}</small>}
              </div>
              <div><p>{card.effectText}</p>{modelsByName.get(card.name)?.modelWarning && <p className="card-warning">{modelsByName.get(card.name)!.modelWarning}</p>}</div>
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
