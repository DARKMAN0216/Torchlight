import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
vi.mock('@tauri-apps/api/core', () => mocks)
let values: Map<string, string>
const key = 'vorax-monster-dictionary-v1'
const original = JSON.stringify({ version: 1, entries: [{ name: '红瘟三头犬', race: 'aberrant', rarity: 'boss' }] })
const changed = JSON.stringify({ version: 1, entries: [{ name: '刺蜥兽', race: 'aberrant', rarity: 'magic' }] })
beforeEach(() => {
  vi.resetModules(); mocks.invoke.mockReset(); mocks.isTauri.mockReturnValue(true)
  values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  })
})
const native = (dictionary: string | null) => ({ directory: 'C:/stable/user-data', dictionary, workspace: null })

it('migrates the existing dictionary before App can write defaults', async () => {
  values.set(key, original)
  mocks.invoke.mockResolvedValueOnce(native(null)).mockResolvedValue(undefined)
  const store = await import('./userData')
  await store.initializeUserData()
  expect(mocks.invoke).toHaveBeenCalledWith('save_user_data', { key, raw: original, expected: null })
  expect(store.readUserData(key)).toBe(original)
  expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === 'save_user_data')).toHaveLength(1)
})

it('restores from the independent file after WebView storage is empty', async () => {
  mocks.invoke.mockResolvedValueOnce(native(original))
  const store = await import('./userData'); await store.initializeUserData()
  expect(store.readUserData(key)).toBe(original)
  expect(values.get(key)).toBe(original)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})

it('preserves a disagreeing legacy dictionary instead of discarding it', async () => {
  values.set(key, changed); mocks.invoke.mockResolvedValueOnce(native(original))
  const store = await import('./userData'); await store.initializeUserData()
  expect(values.get(key)).toBe(original)
  expect([...values.entries()].some(([k, v]) => k.startsWith(`${key}-pre-migration-`) && v === changed)).toBe(true)
})

it('does not start or overwrite when a native file is corrupt', async () => {
  mocks.invoke.mockResolvedValueOnce(native('{broken'))
  const store = await import('./userData')
  await expect(store.initializeUserData()).rejects.toThrow()
  await expect(store.saveUserData(key, original)).rejects.toThrow('尚未加载')
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})

it('rejects structurally invalid JSON before migration', async () => {
  values.set(key, '{}'); mocks.invoke.mockResolvedValueOnce(native(null))
  const store = await import('./userData')
  await expect(store.initializeUserData()).rejects.toThrow('数据格式无效')
  expect(values.get(key)).toBe('{}')
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})

it('serializes writes with the last successful disk content as the revision', async () => {
  mocks.invoke.mockResolvedValueOnce(native(original)).mockResolvedValue(undefined)
  const store = await import('./userData'); await store.initializeUserData()
  await Promise.all([store.saveUserData(key, changed), store.saveUserData(key, original)])
  expect(mocks.invoke.mock.calls.slice(1)).toEqual([
    ['save_user_data', { key, raw: changed, expected: original }],
    ['save_user_data', { key, raw: original, expected: changed }],
  ])
})

it('a failed/conflicting save does not report success or update the dictionary cache', async () => {
  mocks.invoke.mockResolvedValueOnce(native(original)).mockRejectedValue(new Error('another client changed data'))
  const store = await import('./userData'); await store.initializeUserData()
  await expect(store.saveUserData(key, changed)).rejects.toThrow('another client')
  expect(store.readUserData(key)).toBe(original)
  expect(values.get(key)).toBe(original)
  await expect(store.saveUserData(key, original)).rejects.toThrow('another client')
  expect(mocks.invoke).toHaveBeenCalledTimes(2)
})

it('native save remains durable if browser cache quota is exhausted', async () => {
  mocks.invoke.mockResolvedValueOnce(native(original)).mockResolvedValue(undefined)
  const store = await import('./userData'); await store.initializeUserData()
  vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota') })
  await store.saveUserData(key, changed)
  expect(store.readUserData(key)).toBe(changed)
})
