import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhysicalSize } from '@tauri-apps/api/window'
import capability from '../../src-tauri/capabilities/default.json'
import { changeFloatingWindow } from './floatingWindow'

const native = vi.hoisted(() => ({
  isTauri: vi.fn(),
  getCurrentWindow: vi.fn(),
  window: {
    innerSize: vi.fn(), isMaximized: vi.fn(), unmaximize: vi.fn(), maximize: vi.fn(),
    setMinSize: vi.fn(), setSize: vi.fn(), setAlwaysOnTop: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }))
vi.mock('@tauri-apps/api/window', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/window')>(),
  getCurrentWindow: native.getCurrentWindow,
}))

beforeEach(() => {
  vi.resetAllMocks()
  native.isTauri.mockReturnValue(true)
  native.getCurrentWindow.mockReturnValue(native.window)
  native.window.innerSize.mockResolvedValue(new PhysicalSize(2160, 1380))
  native.window.isMaximized.mockResolvedValue(false)
  for (const setter of ['unmaximize', 'maximize', 'setMinSize', 'setSize', 'setAlwaysOnTop'] as const) {
    native.window[setter].mockResolvedValue(undefined)
  }
})

describe('floating desktop window', () => {
  it('grants the main window every setter permission used by floating mode', () => {
    expect(capability.windows).toEqual(['main'])
    for (const command of ['set-min-size', 'set-size', 'set-always-on-top', 'unmaximize', 'maximize']) {
      expect(capability.permissions).toContain(`core:window:allow-${command}`)
    }
  })

  it('rejects web preview without attempting a native call', async () => {
    native.isTauri.mockReturnValue(false)
    await expect(changeFloatingWindow(true, null)).rejects.toThrow('网页预览不支持置顶窗口')
    expect(native.getCurrentWindow).not.toHaveBeenCalled()
  })

  it('enters at logical size and restores physical size without DPI multiplication', async () => {
    const previous = await changeFloatingWindow(true, null)
    expect(native.window.setSize).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'Logical', width: 460, height: 680,
    }))
    expect(native.window.setAlwaysOnTop).toHaveBeenLastCalledWith(true)
    expect(await changeFloatingWindow(false, previous)).toBeNull()
    expect(native.window.setSize).toHaveBeenLastCalledWith(new PhysicalSize(2160, 1380))
    expect(native.window.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
  })

  it('unmaximizes for the compact panel and restores maximized state on exit', async () => {
    native.window.isMaximized.mockResolvedValue(true)
    const previous = await changeFloatingWindow(true, null)
    expect(native.window.unmaximize).toHaveBeenCalledOnce()
    await changeFloatingWindow(false, previous)
    expect(native.window.maximize).toHaveBeenCalledOnce()
  })

  it('reports permission rejection accurately instead of calling it web preview', async () => {
    native.window.setAlwaysOnTop.mockRejectedValueOnce('window.set_always_on_top not allowed')
    await expect(changeFloatingWindow(true, null)).rejects.toThrow(
      '开启置顶失败：window.set_always_on_top not allowed',
    )
    expect(native.window.setSize).not.toHaveBeenCalled()
  })

  it('rolls back an interrupted entry and preserves the original error', async () => {
    native.window.setSize.mockRejectedValueOnce(new Error('resize failed'))
    await expect(changeFloatingWindow(true, null)).rejects.toThrow('调整浮窗尺寸失败：resize failed')
    expect(native.window.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    expect(native.window.setSize).toHaveBeenLastCalledWith(new PhysicalSize(2160, 1380))
  })
})
