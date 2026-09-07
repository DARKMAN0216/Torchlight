import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ClientRecorder, journalArchive, summarizeRun, type RecordedRun } from '../learning/clientRecorder'
import { downloadRecording, listRecordedRuns, readRecordedRun, type RunListing } from '../storage/runJournal'
import { persistentCards } from '../data/sampleLibrary'

const statusLabel: Record<string, string> = { selected: '暂选', 'confirm-clicked': '已点确认，待换面', 'transition-observed': '点击与换面已校验', manual: '人工确认', uncertain: '待核对', ignored: '误记' }
const raceLabel: Record<string, string> = { awakened: '觉醒者', aberrant: '异魔', swarm: '蛊虫', construct: '骨卫兵' }
const rarityLabel: Record<string, string> = { common: '普通', magic: '魔法', rare: '稀有', boss: '首领' }
const passiveName = (id: string) => persistentCards.find(c => c.id === id)?.name ?? id
function tagLabel(tag: string) {
  const [kind, value] = tag.split(':')
  if (kind === 'phase') return ({ permanent: '常驻选择', potion: '药剂选择', expanded: '药箱展开', surgery: '后期手术', unknown: '未知阶段' } as Record<string, string>)[value] ?? value
  if (kind === 'round') return `第 ${value} 回合`
  if (kind === 'groups') return `${value} 组怪物`
  if (kind === 'race') return raceLabel[value] ?? value
  if (kind === 'rarity') return rarityLabel[value] ?? value
  if (kind === 'loadout') return `常驻组合：${value === 'none' ? '无' : value.split('+').map(passiveName).join('＋')}`
  if (kind === 'passive') return passiveName(value)
  if (tag === 'route:pupa-without-swarm') return '人蛹标本缺蛊虫'
  return tag
}
export function RunJournal({ recorder }: { recorder: ClientRecorder }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<RunListing[]>([])
  const [selected, setSelected] = useState<RecordedRun | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const shown = selected ?? recorder.run
  const summary = useMemo(() => shown ? summarizeRun(shown) : null, [shown])
  const live = recorder.run ? summarizeRun(recorder.run) : null
  const refresh = () => { setError(''); void listRecordedRuns().then(setList).catch(e => setError(String(e))) }
  useEffect(() => {
    if (!open) return
    refresh(); closeButton.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); opener.current?.focus() }
      if (event.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, summary, [href]') ?? [])]
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { request.current++; window.removeEventListener('keydown', key) }
  }, [open])
  const select = async (runId: string) => {
    const token = ++request.current
    if (!runId) { setSelected(null); setLoading(false); return }
    setLoading(true); setError('')
    try { const run = await readRecordedRun(runId); if (token === request.current) setSelected(run) }
    catch (e) { if (token === request.current) setError(String(e)) }
    finally { if (token === request.current) setLoading(false) }
  }
  const exportData = (learning: boolean) => {
    if (!shown) return
    try { downloadRecording(`${shown.runId}.${learning ? 'runs.jsonl' : 'journal.json'}`,
      learning ? JSON.stringify(journalArchive(shown)) + '\n' : JSON.stringify(shown, null, 2)) }
    catch (e) { setError(String(e)) }
  }
  return <>
    <div className="run-recording-strip" aria-label="牌局自动记录">
      <span role="status">{recorder.enabled ? '自动记录开启' : '自动记录已暂停'} · {live?.captures ?? 0} 次识别 · {live?.choices ?? 0} 条选牌{recorder.pending.length ? ` · 待保存 ${recorder.pending.length}` : ' · 已保存'}</span>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>牌局记录</button>
      <button type="button" onClick={() => recorder.toggle()}>{recorder.enabled ? '暂停记录' : '恢复记录'}</button>
    </div>
    {recorder.error && <div className="recording-error" role="alert">{recorder.error}
      <button type="button" onClick={() => recorder.retry()}>重试保存</button>
      <button type="button" onClick={() => downloadRecording('recording-recovery.json', JSON.stringify({ currentRun: recorder.run, unsavedEvents: recorder.pending }, null, 2))}>导出未保存备份</button>
    </div>}
    {open && <div className="catalog-backdrop"><section className="catalog-dialog run-journal-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="run-journal-title">
      <header className="catalog-header"><div><h2 id="run-journal-title">牌局记录</h2><p>只记录实际识别与选牌证据，不执行游戏操作、不改变推荐。</p></div>
        <button ref={closeButton} className="catalog-close" type="button" onClick={() => { setOpen(false); opener.current?.focus() }}>关闭</button></header>
      <div className="run-journal-content">
        <p>{isTauri() ? '独立存储：%LOCALAPPDATA%/VoraxDecisionAssistant/user-data/recorded-runs。更新客户端不会清理。' : '网页预览：仅存于当前浏览器，请导出备份；正式客户端使用独立磁盘目录。'}</p>
        <p>保持原来的操作：F8 识别 → 游戏选牌并确认 → F8 同步。启动后首次识别开始记录；新牌局按钮或可靠轮次回退会分局。同为第 1 回合重开，请点“新牌局”。导入截图单独保存，不混入实战。</p>
        <div className="run-journal-actions">
          <label>查看牌局 <select aria-label="查看牌局" value={selected?.runId ?? ''} onChange={e => void select(e.target.value)}>
            <option value="">当前记录</option>{list.filter(r => r.runId !== recorder.run?.runId).map(r => <option key={r.runId} value={r.runId}>{new Date(r.modifiedMs).toLocaleString()} · {r.eventCount} 事件 · {r.runId.slice(0, 8)}</option>)}
          </select></label>
          <button type="button" onClick={refresh}>刷新列表</button>
          <button type="button" disabled={!shown || loading} onClick={() => exportData(false)}>导出原始记录</button>
          <button type="button" disabled={!shown || loading} onClick={() => exportData(true)}>导出学习档案</button>
          <button type="button" disabled={!recorder.run || live?.closed} onClick={() => recorder.end()}>结束本局记录</button>
        </div>
        {error && <p className="recording-error" role="alert">{error}</p>}
        {loading ? <p role="status">读取历史记录…</p> : shown && summary ? <>
          <h3>{summary.closed ? '已结束的记录' : '记录中的牌局片段'} · {shown.runId.slice(0, 8)}</h3>
          <p>{summary.captures} 次识别 / {summary.reliable} 次六槽及总活性校验通过 · {summary.choices} 条选牌 · {summary.gaps} 条缺口提示</p>
          <p className="run-tags">分类：{summary.tags.map(tagLabel).join(' · ') || '暂无可靠局面可分类'}</p>
          <p className="catalog-warning">自动记录不等于可训练样本：漏拍、随机落点、常驻获得时间和终局仍需核验；本版不会把最后一次截图当最终收益。重启后建立新片段，不冒充完整牌局。</p>
          <ol className="run-event-list">{shown.events.map(event => <li key={event.id}>
            <span>#{event.sequence} · {new Date(event.recordedAt).toLocaleTimeString()} · </span>
            {event.type === 'start' ? `开始记录（${{ 'first-capture': '首次识别，完整性待核对', 'new-game': '手动新牌局', 'round-reset': '轮次回退，新局待核对', import: '导入截图，独立片段' }[event.reason]}）` : event.type === 'end' || event.type === 'gap' ? event.reason
              : event.type === 'choice' ? `${event.record.name}：${statusLabel[event.record.status] ?? event.record.status}；目标 ${event.record.targetSlots.join('、') || '未记录'}；${event.beforeCaptureId ? '已关联前态' : '前态待核对'}`
                : <details><summary>第 {event.capture.snapshot.round?.value ?? '?'} 回合 · {event.capture.frame ? `活性 ${event.capture.frame.displayedActivity ?? '未知'}` : '六槽不完整'} · {event.capture.issues.length ? '待核对' : '局面校验通过'}</summary>
                  <p>候选：{event.capture.snapshot.candidateCardNames?.map(c => c.value).join(' / ') || '未取得候选名称'}</p>
                  <p>已记录常驻：{event.capture.recordedPassiveIds.filter(id => id !== 'none').map(passiveName).join('、') || '无'}（软件记录，非屏幕验证）</p>
                  <p>{event.capture.issues.join('；') || '保留原始识别结果；未从旧局面补全'}</p>
                  {event.capture.frame && <ul>{event.capture.frame.state.monsters.map((m, i) => <li key={m.id}>{i + 1} 号罐：{m.race ? `${raceLabel[m.race]} · ${rarityLabel[m.rarity]} · ${m.unitActivity} 活性 × ${m.quantity} 数量` : '空罐'}</li>)}</ul>}
                  <details><summary>原始六槽 JSON</summary><pre>{JSON.stringify(event.capture.snapshot.monsterSlots, null, 2)}</pre></details>
                </details>}
          </li>)}</ol>
        </> : <p>尚无记录。按 F8 获取第一张实际画面后自动开始；示例数据不会入账。</p>}
      </div>
    </section></div>}
  </>
}
