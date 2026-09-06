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
  it('returns choices even without a new OCR sequence and controls do not capture', async () => {
    const choices={enabled:true,hookActive:true,message:'暂选',pending:null,records:[]}
    response({sequence:3,sessionId:'same',status:'completed',choices})
    expect((await provider.readHotkeyRecognition(3,'same')).choices).toEqual(choices)
    await provider.controlChoices('disable')
    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:28765/choices/disable',expect.objectContaining({method:'POST'}))
  })
  it('starts and pauses using idempotent endpoints, not another screenshot', async () => {
    response({})
    await provider.setFollow(true); await provider.setFollow(false)
    expect(fetch).toHaveBeenNthCalledWith(1,'http://127.0.0.1:28765/follow/start',expect.objectContaining({method:'POST'}))
    expect(fetch).toHaveBeenNthCalledWith(2,'http://127.0.0.1:28765/follow/pause',expect.objectContaining({method:'POST'}))
  })
  it('reports follow status without a new screenshot and rejects paused/stale results', async () => {
    const follow={enabled:true,generation:3,status:'following',message:'已同步'}
    const payload={sequence:2,sessionId:'s',status:'completed',triggerSource:'continuous-follow',followGeneration:3,follow,result:{snapshot:{capturedAt:'now'}}}
    response(payload)
    expect((await provider.readHotkeyRecognition(1,'s')).snapshot?.capturedAt).toBe('now')
    response({...payload,follow:{...follow,enabled:false}})
    expect((await provider.readHotkeyRecognition(1,'s')).snapshot).toBeUndefined()
    response({...payload,followGeneration:2})
    expect((await provider.readHotkeyRecognition(1,'s')).snapshot).toBeUndefined()
    response(payload)
    expect((await provider.readHotkeyRecognition(2,'s')).follow).toEqual(follow)
  })
  it('reports receipt source and timing even before a result arrives', async () => {
    response({ sequence: 2, status: 'recognizing', triggerSource: 'f8-hook', elapsedMs: 650 })
    expect(await provider.readHotkeyRecognition(1)).toMatchObject({ sequence: 2, triggerSource: 'f8-hook', elapsedMs: 650 })
  })
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
