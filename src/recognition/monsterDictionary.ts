import { raceIds, rarityIds, type RaceId, type RarityId } from '../types/game'
import type { RecognizedMonsterSlot } from './contracts'
import { readUserData } from '../storage/userData'

export interface MonsterNameEntry { name: string; race: RaceId; rarity: RarityId }
export const monsterDictionaryKey = 'vorax-monster-dictionary-v1'
// User-confirmed on 2026-09-06. Different names may share the same attributes.
export const builtinMonsterNames: readonly MonsterNameEntry[] = [
  { name: '空心茧', race: 'swarm', rarity: 'boss' },
  { name: '寄生蝴蝶', race: 'swarm', rarity: 'rare' },
  { name: '刚盾卫兵', race: 'construct', rarity: 'rare' },
  { name: '禁典学者', race: 'awakened', rarity: 'rare' },
  { name: '邪眼异兽', race: 'aberrant', rarity: 'rare' },
  { name: '堕落者', race: 'awakened', rarity: 'magic' },
  { name: '朝圣者', race: 'awakened', rarity: 'magic' },
  { name: '裂颚兽', race: 'aberrant', rarity: 'magic' },
  { name: '轻弩兵', race: 'construct', rarity: 'magic' },
  { name: '蝎兽', race: 'aberrant', rarity: 'common' },
  { name: '腐囊异兽', race: 'aberrant', rarity: 'rare' },
  { name: '赤螳螂', race: 'swarm', rarity: 'magic' },
]

export const normalizeMonsterName = (name: string) => name.normalize('NFKC').replace(/\s+/g, '')

export function validateMonsterEntry(value: unknown): MonsterNameEntry {
  if (!value || typeof value !== 'object') throw new Error('名称记录格式无效')
  const entry = value as Partial<MonsterNameEntry>
  const name = typeof entry.name === 'string' ? normalizeMonsterName(entry.name) : ''
  if (!/^[\u4e00-\u9fff]{2,24}$/.test(name)) throw new Error('请填写 2–24 个汉字的完整怪物名称')
  if (!raceIds.includes(entry.race as RaceId) || !rarityIds.includes(entry.rarity as RarityId)) {
    throw new Error('请确认种群和稀有度')
  }
  return { name, race: entry.race!, rarity: entry.rarity! }
}

export function monsterDictionary(custom: readonly MonsterNameEntry[] = []): Map<string, MonsterNameEntry> {
  return new Map([...builtinMonsterNames, ...custom].map((entry) => [normalizeMonsterName(entry.name), entry]))
}

export function upsertMonsterName(custom: readonly MonsterNameEntry[], value: unknown, replace = false): MonsterNameEntry[] {
  const entry = validateMonsterEntry(value)
  const existing = monsterDictionary(custom).get(entry.name)
  if (custom.length >= 2000 && !custom.some((item) => item.name === entry.name)) throw new Error('手动字典最多保存 2000 条')
  if (existing && (existing.race !== entry.race || existing.rarity !== entry.rarity) && !replace) {
    throw new Error(`“${entry.name}”已有不同属性；请明确勾选覆盖，或修正名称`)
  }
  return [...custom.filter((item) => item.name !== entry.name), entry]
}

export function parseMonsterDictionary(text: string): MonsterNameEntry[] {
  const data = JSON.parse(text)
  if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 2000) {
    throw new Error('字典文件格式或版本不支持（最多 2000 条）')
  }
  const entries = data.entries.map(validateMonsterEntry) as MonsterNameEntry[]
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) throw new Error('文件包含重复名称，请先整理')
  return entries
}

export const serializeMonsterDictionary = (entries: readonly MonsterNameEntry[]) => JSON.stringify({ version: 1, entries }, null, 2)

export function loadMonsterDictionary(): { entries: MonsterNameEntry[]; error: string } {
  try {
    const raw = readUserData(monsterDictionaryKey)
    return { entries: raw ? parseMonsterDictionary(raw) : [], error: '' }
  } catch {
    return { entries: [], error: '怪物字典读取失败，原始存储未改动。请先导出原始备份，再修复或导入字典。' }
  }
}

export function resolveMonsterName(slot: RecognizedMonsterSlot, dictionary: ReadonlyMap<string, MonsterNameEntry>) {
  const entry = slot.name && slot.name.confidence >= 0.85
    ? dictionary.get(normalizeMonsterName(slot.name.value)) : undefined
  if (!entry || !slot.occupied.value) return { slot, issues: [] as string[] }
  // A reliable whole-name match is authoritative, including user overrides.
  // Visual attributes are fallback evidence only, never a veto on saved names.
  const evidence = { confidence: slot.name!.confidence, sourceRegion: slot.name!.sourceRegion }
  return { slot: { ...slot, raceId: { ...evidence, value: entry.race }, rarity: { ...evidence, value: entry.rarity } }, issues: [] as string[] }
}
