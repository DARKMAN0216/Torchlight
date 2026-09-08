import { useState } from 'react'
import { rarityIds, type GameState, type RarityId } from '../types/game'
import { rarityLabels } from '../data/sampleLibrary'
export function NewbornSwarmSettings({ value, onChange }: {
  value: GameState['newbornSwarm']; onChange: (value: GameState['newbornSwarm']) => void
}) {
  const [quantity, setQuantity] = useState(value ? String(value.quantity) : '')
  const [activity, setActivity] = useState(value ? String(value.unitActivity) : '')
  const [rarity, setRarity] = useState<RarityId | ''>(value?.rarity ?? '')
  const valid = Boolean(rarity && Number.isSafeInteger(Number(quantity)) && Number(quantity) > 0 &&
    Number.isSafeInteger(Number(activity)) && Number(activity) > 0)
  return <fieldset className="newborn-settings">
    <legend>新增蛊虫基础属性（不含常驻和药剂加成）</legend>
    <p>旧存档兼容的单一蛊虫基础值，仅供旧常驻场景使用。活性育卵激素等7张新模型药剂改用右侧导入的四稀有度基础值；此项不能替代随机稀有度数据。</p>
    <label>新蛊虫数量<input type="number" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)} /></label>
    <label>新蛊虫单体活性<input type="number" min="1" value={activity} onChange={e=>setActivity(e.target.value)} /></label>
    <label>新蛊虫稀有度<select aria-label="新蛊虫稀有度" value={rarity} onChange={e=>setRarity(e.target.value as RarityId)}>
      <option value="">请选择实际稀有度</option>{rarityIds.map(r=><option key={r} value={r}>{rarityLabels[r]}</option>)}
    </select></label>
    <button type="button" disabled={!valid} onClick={()=>onChange({quantity:Number(quantity),unitActivity:Number(activity),rarity:rarity as RarityId})}>确认基础属性并启用计算</button>
    <button type="button" onClick={()=>{onChange(undefined);setQuantity('');setActivity('');setRarity('')}}>清除基础属性</button>
    <p>{value ? `已确认：${value.unitActivity} × ${value.quantity} / ${rarityLabels[value.rarity]}` : '尚未确认，不采用默认值。'}</p>
  </fieldset>
}
