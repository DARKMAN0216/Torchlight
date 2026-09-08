import { useState } from 'react'
import type { GameState } from '../types/game'
import { parsePersistentModel } from '../engine/persistentModelData'

export function PersistentModelSettings({ value, onChange }: {
  value: GameState['persistentModel']; onChange: (value: GameState['persistentModel']) => void
}) {
  const [message, setMessage] = useState('')
  return <section className="persistent-model-settings">
    <h3>常驻结算参数</h3>
    <p>24 张常驻与已校准药剂共用事件规则。新怪基础值使用 rarityBases（按稀有度）；升阶使用转换样本/先验，两者不能混用。名称字典不包含基础数值。</p>
    <label>人蛹重复次数 <select value={value?.pupaRepetitions ?? 'totalX'} onChange={e => onChange({ ...value, pupaRepetitions: e.target.value as 'totalX' | 'additionalX' })}>
      <option value="totalX">总计 X 次（默认假设）</option><option value="additionalX">首次后额外 X 次</option>
    </select></label>
    <label>常驻顺序 <select value={value?.persistentOrder ?? 'acquisition'} onChange={e => onChange({ ...value, persistentOrder: e.target.value as 'acquisition' | 'reverse' | 'random' })}>
      <option value="acquisition">获得顺序（旧记录按列表）</option><option value="reverse">反向顺序（检查敏感性）</option><option value="random">随机顺序（检查敏感性）</option>
    </select></label>
    <p>基础怪物 {value?.monsters?.length ?? 0} 条 · 升阶样本 {value?.raritySamples?.length ?? 0} 条</p>
    <p>空心茧专属基础值：{value?.specialBases?.hollowCocoon ? '已配置' : '未知'}。使用 specialBases.hollowCocoon 导入 quantity、unitActivity；不能借用普通首领基础值。</p>
    <p>稀有度基础值 {Object.keys(value?.rarityBases ?? {}).length}/4：普通 common、魔法 magic、稀有 rare、首领 boss。每项填写 quantity（数量）和 unitActivity（单体活性），通过下方 JSON 导入。</p>
    <label>导入常驻模型数据 JSON <input type="file" accept=".json,application/json" onChange={async e => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      try {
        if (file.size > 5_000_000) throw new Error('文件不能超过5MB')
        const parsed = parsePersistentModel(await file.text())
        onChange({ ...value, ...parsed }); setMessage('模型数据已导入，已重新计算当前候选。')
      } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败') }
    }} /></label>
    <p role="status">{message}</p>
    <small>周期按全局回合计算；吞噬按数量与单体活性分别求和。规则顺序与这些解释仍需实战校准。</small>
  </section>
}
