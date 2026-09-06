import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalScreenRecognitionProvider } from './localBridge'

const provider = new LocalScreenRecognitionProvider()
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => { vi.unstubAllGlobals() })

function response(payload: object) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
}

describe('global recognition polling', () => {
  it('exposes in-progress and actual registration state immediately', async () => {
    response({ sequence: 5, sessionId: 'a', status: 'recognizing', hotkeyRegistered: true })
    expect(await provider.readHotkeyRecognition(4, 'a')).toMatchObject({ status: 'recognizing', hotkeyRegistered: true })
  })
  it('consumes a lower sequence after the server restarts', async () => {
    response({ sequence: 1, sessionId: 'new', status: 'completed', result: { snapshot: { capturedAt: 'now' } } })
    expect((await provider.readHotkeyRecognition(10, 'old')).snapshot?.capturedAt).toBe('now')
  })
  it('does not reapply an already consumed result', async () => {
    response({ sequence: 1, sessionId: 'same', status: 'completed', result: { snapshot: { capturedAt: 'now' } } })
    expect((await provider.readHotkeyRecognition(1, 'same')).snapshot).toBeUndefined()
  })
  it('preserves registration and capture error reasons', async () => {
    response({ sequence: 1, sessionId: 'same', status: 'failed', error: '游戏未在前台', hotkeyRegistered: false, hotkeyError: '1409' })
    expect(await provider.readHotkeyRecognition(0, 'same')).toMatchObject({ error: '游戏未在前台', hotkeyRegistered: false, hotkeyError: '1409' })
  })
})
