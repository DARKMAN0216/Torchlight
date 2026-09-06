import { useEffect, useRef, useState } from 'react'
import { raceLabels, rarityLabels } from '../data/sampleLibrary'
import { raceIds, rarityIds, type RaceId, type RarityId } from '../types/game'
import type { RecognitionSnapshot } from '../recognition/contracts'
import { saveUserData, userDataDirectory } from '../storage/userData'
import {
  monsterDictionary, monsterDictionaryKey, normalizeMonsterName, parseMonsterDictionary,
  serializeMonsterDictionary, upsertMonsterName, type MonsterNameEntry,
} from '../recognition/monsterDictionary'

interface Props {
  entries: MonsterNameEntry[]
  loadError: string
  snapshot: RecognitionSnapshot | null
  onSave: (entries: MonsterNameEntry[]) => void
  onClose: () => void
}

export function MonsterDictionaryDialog({ entries, loadError, snapshot, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [race, setRace] = useState<RaceId | ''>('')
  const [rarity, setRarity] = useState<RarityId | ''>('')
  const [replace, setReplace] = useState(false)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const saving = useRef(false)
  const dictionary = monsterDictionary(entries)
  const rows = [...dictionary.values()].filter((entry) => entry.name.includes(query.trim()))
  const observed = snapshot?.monsterSlots?.filter((slot) => slot.occupied.value) ?? []

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  const persist = async (next: MonsterNameEntry[]) => {
    if (saving.current) throw new Error('正在保存，请稍后再操作')
    if (loadError && !window.confirm('原字典无法读取。确认已备份，并用当前记录替换原始存储？')) return
    // Commit memory only after durable storage succeeds; never claim a failed save worked.
    saving.current = true
    try { await saveUserData(monsterDictionaryKey, serializeMonsterDictionary(next)) }
    finally { saving.current = false }
    onSave(next)
    setReplace(false)
    setMessage('已保存。下一次 F8 或导入截图自动使用；不会用旧截图覆盖当前局面。')
  }
  const report = (error: unknown) => setMessage(error instanceof Error ? error.message : '操作失败，请重试')
  const download = (text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <dialog ref={dialog} className="monster-name-dialog" onCancel={onClose} aria-labelledby="monster-name-title">
    <header className="catalog-header">
      <div><h2 id="monster-name-title">怪物名字典</h2><p>可信名称完整命中后，直接采用字典中的种群＋稀有度，不再校验颜色或图标；未命中时保留视觉兜底。</p></div>
      <button type="button" onClick={onClose}>关闭</button>
    </header>
    <div className="monster-name-content">
      <p>内置 11 条 · 手动记录 {entries.length} 条。字典独立保存，新牌局和撤销不清空；换电脑请导出后导入。</p>
      <p className="storage-location">{userDataDirectory ? `独立数据目录：${userDataDirectory}；每次变更先备份，升级不清理。` : '网页预览仅保存于当前浏览器；请使用新版客户端获得独立文件备份。'}</p>
      {loadError ? <p role="alert">{loadError}</p> : null}
      <section aria-label="本次怪物名称" className="monster-observations">
        <h3>本次识别 · {snapshot ? new Date(snapshot.capturedAt).toLocaleTimeString() : '尚无截图'}</h3>
        <p>点击名称带入下方，先修正 OCR 错字，再手动确认属性。下列信息来自本次截图，不是左侧旧局面。</p>
        <div className="monster-observation-grid">{observed.map((slot) => {
          const raw = slot.name?.value ?? ''
          const entry = dictionary.get(normalizeMonsterName(raw))
          return <button type="button" key={slot.slotId} onClick={() => {
            setName(raw); setRace(''); setRarity(''); setReplace(false); setMessage('请核对完整名称，并选择种群和稀有度')
            nameInput.current?.focus()
          }}>
            <strong>{slot.slotId} · {raw || '名称未读出，手动输入'}</strong>
            <span>{entry ? `已记录：${raceLabels[entry.race]} / ${rarityLabels[entry.rarity]}` : '未收录，可手动记录'}</span>
            <small>视觉：{slot.raceId ? raceLabels[slot.raceId.value] : '种群未知'} / {slot.rarity ? rarityLabels[slot.rarity.value] : '稀有度未知'} · 名称可信度 {Math.round((slot.name?.confidence ?? 0) * 100)}%</small>
          </button>
        })}</div>
      </section>
      <form className="monster-name-form" onSubmit={(event) => {
        event.preventDefault()
        try { void persist(upsertMonsterName(entries, { name, race, rarity }, replace)).catch(report) } catch (error) { report(error) }
      }}>
        <label>完整怪物名称<input ref={nameInput} value={name} maxLength={24} onChange={(event) => { setName(event.target.value); setReplace(false) }} placeholder="例如：寄生蝴蝶" required /></label>
        <label>确认种群<select value={race} onChange={(event) => setRace(event.target.value as RaceId | '')} required>
          <option value="">请选择种群</option>{raceIds.map((id) => <option key={id} value={id}>{raceLabels[id]}</option>)}
        </select></label>
        <label>确认稀有度<select value={rarity} onChange={(event) => setRarity(event.target.value as RarityId | '')} required>
          <option value="">请选择稀有度</option>{rarityIds.map((id) => <option key={id} value={id}>{rarityLabels[id]}</option>)}
        </select></label>
        <button className="primary-button" type="submit">保存名称记录</button>
      </form>
      <label className="monster-replace"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />允许覆盖已有同名的不同属性（保存／导入）</label>
      <p role="status" className="monster-name-message">{message}</p>
      <div className="monster-dictionary-actions">
        <button type="button" onClick={() => download(serializeMonsterDictionary(entries), 'vorax-monster-dictionary.json')}>导出手动字典</button>
        {loadError ? <button type="button" onClick={() => {
          try { download(localStorage.getItem(monsterDictionaryKey) ?? '', 'vorax-monster-dictionary-raw-backup.json') } catch (error) { report(error) }
        }}>导出原始备份</button> : null}
        <label>导入字典<input type="file" accept="application/json,.json" onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          try {
            if (file.size > 1024 * 1024) throw new Error('字典文件超过 1 MB')
            const imported = parseMonsterDictionary(await file.text())
            const next = imported.reduce((all, entry) => upsertMonsterName(all, entry, replace), entries)
            await persist(next)
          } catch (error) { report(error) }
        }} /></label>
      </div>
      <label className="monster-dictionary-search">搜索已有名称<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <ul className="monster-dictionary-list">{rows.map((entry) => {
        const custom = entries.some((item) => item.name === entry.name)
        return <li key={entry.name}>
          <span><strong>{entry.name}</strong> · {raceLabels[entry.race]} / {rarityLabels[entry.rarity]} <small>{custom ? '手动' : '内置'}</small></span>
          <div><button type="button" onClick={() => { setName(entry.name); setRace(entry.race); setRarity(entry.rarity); setReplace(false); nameInput.current?.focus() }}>编辑 {entry.name}</button>
            {custom ? <button type="button" onClick={() => {
              if (!window.confirm(`删除“${entry.name}”的手动记录？同名内置记录（如有）将恢复。`)) return
              void persist(entries.filter((item) => item.name !== entry.name)).catch(report)
            }}>删除 {entry.name}</button> : null}</div>
        </li>
      })}</ul>
      {!rows.length ? <p>没有匹配的名称。</p> : null}
    </div>
  </dialog>
}
