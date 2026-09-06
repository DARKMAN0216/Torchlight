import { invoke, isTauri } from '@tauri-apps/api/core'

export const dictionaryKey = 'vorax-monster-dictionary-v1'
export const workspaceKey = 'vorax-decision-assistant-state-v4'
const cache = new Map<string, string | null>()
const persisted = new Map<string, string | null>()
const queues = new Map<string, Promise<void>>()
let ready = false
export let userDataDirectory = ''

export function validateUserData(key: string, raw: string): void {
  const value = JSON.parse(raw)
  const races = ['swarm', 'construct', 'awakened', 'aberrant']
  const rarities = ['common', 'magic', 'rare', 'boss']
  let valid = false
  if (key === dictionaryKey) {
    valid = value?.version === 1 && Array.isArray(value.entries) && value.entries.length <= 2000 &&
      value.entries.every((entry: { name?: string; race?: string; rarity?: string }) =>
        typeof entry?.name === 'string' && /^[\u4e00-\u9fff]{2,24}$/.test(entry.name) &&
        races.includes(entry.race ?? '') && rarities.includes(entry.rarity ?? '')) &&
      new Set(value.entries.map((entry: { name: string }) => entry.name)).size === value.entries.length
  } else if (key === workspaceKey) {
    const state = value?.state
    valid = Array.isArray(state?.monsters) && state.monsters.length === 6 &&
      state.monsters.every((m: { race: string | null; rarity: string; quantity: number; unitActivity: number }) =>
        m && (m.race === null || races.includes(m.race)) && rarities.includes(m.rarity) &&
        Number.isFinite(m.quantity) && m.quantity >= 0 && Number.isFinite(m.unitActivity) && m.unitActivity >= 0) &&
      Number.isFinite(state.round) && ['activity', 'preserve', 'strategic'].includes(state.mode) &&
      Array.isArray(value.persistentIds) && Array.isArray(value.candidateIds)
  }
  if (!valid) throw new Error(`${key} 数据格式无效；已停止启动或保存，不覆盖原文件。`)
}

export function readUserData(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null
  return localStorage.getItem(key)
}

export async function initializeUserData(): Promise<void> {
  if (!isTauri()) { ready = true; return }
  const data = await invoke<{ directory: string; dictionary: string | null; workspace: string | null }>('load_user_data')
  if (!data || !data.directory) throw new Error('客户端不支持独立存储，请使用新版客户端；未覆盖现有数据。')
  userDataDirectory = data.directory
  // Validate/read all inputs before any migration. An unreadable file fails closed.
  const values = [
    [dictionaryKey, data.dictionary], [workspaceKey, data.workspace],
  ] as const
  for (const [key, file] of values) {
    persisted.set(key, file)
    const raw = file ?? localStorage.getItem(key)
    if (raw !== null) validateUserData(key, raw)
    cache.set(key, raw)
  }
  for (const [key, file] of values) {
    const raw = cache.get(key) ?? null
    if (file === null && raw !== null) {
      await invoke('save_user_data', { key, raw, expected: null })
      persisted.set(key, raw)
    }
    // Native file wins across client versions/origins. Keep a disagreeing cache
    // as a recovery copy; never silently discard it or merge stale deletions.
    try {
      const legacy = localStorage.getItem(key)
      if (legacy !== null && raw !== legacy) localStorage.setItem(`${key}-pre-migration-${Date.now()}`, legacy)
      if (raw !== null) localStorage.setItem(key, raw)
    } catch { /* Native file is authoritative; browser quota cannot erase it. */ }
  }
  ready = true
}

export function saveUserData(key: string, raw: string): Promise<void> {
  try { validateUserData(key, raw) } catch (error) { return Promise.reject(error) }
  if (!isTauri()) {
    try { localStorage.setItem(key, raw); return Promise.resolve() } catch (error) { return Promise.reject(error) }
  }
  if (!ready) return Promise.reject(new Error('独立数据尚未加载，已阻止覆盖。'))
  const next = (queues.get(key) ?? Promise.resolve()).then(async () => {
    if (persisted.get(key) === raw) return
    await invoke('save_user_data', { key, raw, expected: persisted.get(key) ?? null })
    persisted.set(key, raw)
    cache.set(key, raw)
    try { localStorage.setItem(key, raw) } catch { /* Native save succeeded. */ }
  })
  // A failed write blocks subsequent stale writes until the user reloads.
  queues.set(key, next)
  return next
}
