import type { ChoiceRecord, ChoiceTrackingState } from '../recognition/choiceTracking'

const labels = { selected: '暂选', 'confirm-clicked': '已点确认·待 F8', 'transition-observed': '点击与换面已校验',
  uncertain: '待人工核对', manual: '人工确认', ignored: '已标记误记' }

export function ChoiceJournal({ tracking, log, online, onToggle, onConfirm, onIgnore }: {
  tracking: ChoiceTrackingState | null; log: ChoiceRecord[]; online: boolean
  onToggle: () => void; onConfirm: (record: ChoiceRecord) => void; onIgnore: (record: ChoiceRecord) => void
}) {
  return <div className="choice-journal">
    <div><strong>游戏选牌记录</strong> <button type="button" disabled={!online || !tracking} onClick={onToggle}>
      {tracking?.enabled ? '暂停选牌监听' : '开启选牌监听'}</button></div>
    <p role="status">{!online ? '服务未连接，不能监听选牌' : !tracking ? '需要新版识别服务' :
      !tracking.hookActive ? '鼠标监听未就绪，请手动记录' : tracking.message}</p>
    {tracking?.pending && <p>第 {tracking.pending.cardIndex+1} 张：{tracking.pending.name} · {labels[tracking.pending.status]}
      {tracking.pending.targetSlots.length > 0 && ` · 点击目标：槽 ${tracking.pending.targetSlots.join('、')}`}</p>}
    <details><summary>最近选择（{log.length} 条，最多保存 100 条）</summary>
      <p>只校验点击与画面转移，不是游戏回执；点击目标不代表随机命中。误记常驻请在完整界面取消勾选。</p>
      {log.slice(-8).reverse().map(r => <div className="choice-entry" key={r.id}>
        <strong>回合 {r.round} · 第 {r.cardIndex+1} 张 · {r.name}</strong>
        <span>{labels[r.status]}{r.targetSlots.length ? ` · 点击槽 ${r.targetSlots.join('、')}` : ''}</span>
        {r.status === 'uncertain' && <button type="button" onClick={() => onConfirm(r)}>确实选了这张</button>}
        {r.status !== 'ignored' && <button type="button" onClick={() => onIgnore(r)}>标记误记</button>}
      </div>)}
    </details>
  </div>
}
