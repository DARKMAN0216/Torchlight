import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize, type PhysicalSize } from '@tauri-apps/api/window'

export interface PreviousWindowState {
  size: PhysicalSize
  maximized: boolean
}

export async function changeFloatingWindow(
  enabled: boolean,
  previous: PreviousWindowState | null,
): Promise<PreviousWindowState | null> {
  if (!isTauri()) {
    throw new Error('网页预览不支持置顶窗口，请打开已安装的渴瘾决策器客户端')
  }

  const appWindow = getCurrentWindow()
  let step = '读取窗口状态'
  try {
    if (enabled) {
      const saved = {
        size: await appWindow.innerSize(),
        maximized: await appWindow.isMaximized(),
      }
      step = '开启置顶'
      await appWindow.setAlwaysOnTop(true)
      try {
        if (saved.maximized) {
          step = '取消最大化'
          await appWindow.unmaximize()
        }
        step = '调整浮窗最小尺寸'
        await appWindow.setMinSize(new LogicalSize(360, 280))
        step = '调整浮窗尺寸'
        await appWindow.setSize(new LogicalSize(430, 340))
      } catch (error) {
        // Best-effort rollback; keep the original failure visible to the user.
        await appWindow.setAlwaysOnTop(false).catch(() => {})
        await appWindow.setMinSize(new LogicalSize(1080, 680)).catch(() => {})
        await appWindow.setSize(saved.size).catch(() => {})
        if (saved.maximized) await appWindow.maximize().catch(() => {})
        throw error
      }
      return saved
    }

    step = '恢复窗口最小尺寸'
    await appWindow.setMinSize(new LogicalSize(1080, 680))
    step = '恢复窗口尺寸'
    // innerSize returns physical pixels: do not restore it as LogicalSize at high DPI.
    await appWindow.setSize(previous?.size ?? new LogicalSize(1440, 920))
    if (previous?.maximized) {
      step = '恢复最大化'
      await appWindow.maximize()
    }
    step = '取消置顶'
    await appWindow.setAlwaysOnTop(false)
    return null
  } catch (error) {
    throw new Error(`${step}失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
