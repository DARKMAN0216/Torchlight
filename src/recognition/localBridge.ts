import type { RecognitionSnapshot, ScreenRecognitionProvider } from './contracts'
import type { ChoiceTrackingState } from './choiceTracking'

const serviceUrl = 'http://127.0.0.1:28765'

export interface FollowState {
  enabled: boolean
  generation: number
  status: 'paused' | 'settling' | 'recognizing' | 'checking' | 'following' | 'waiting'
  message: string
  retryCount?: number
  retryAfterMs?: number
  lastReason?: string
  ocrCount?: number
}

interface LocalRecognitionResponse {
  snapshot: RecognitionSnapshot
  diagnostics?: RecognitionSnapshot['diagnostics']
  error?: string
}

interface HotkeyRecognitionResponse {
  choices?: ChoiceTrackingState
  follow?: FollowState
  followGeneration?: number
  elapsedMs?: number
  triggerSource?: string
  sessionId?: string
  hotkeyRegistered?: boolean
  hotkeyError?: string | null
  sequence: number
  status: 'idle' | 'recognizing' | 'completed' | 'failed'
  result: LocalRecognitionResponse | null
  error: string | null
}

export interface HotkeyRecognitionEvent {
  choices?: ChoiceTrackingState
  follow?: FollowState
  elapsedMs?: number
  triggerSource?: string
  sequence: number
  sessionId?: string
  status: HotkeyRecognitionResponse['status']
  hotkeyRegistered?: boolean
  hotkeyError?: string | null
  snapshot?: RecognitionSnapshot
  error?: string
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 45_000): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readResponse(response: Response): Promise<LocalRecognitionResponse> {
  const payload = await response.json() as LocalRecognitionResponse
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `识别服务返回 ${response.status}`)
  }
  return payload
}

export class LocalScreenRecognitionProvider implements ScreenRecognitionProvider {
  readonly id = 'local-rapidocr'
  readonly name = '本地 RapidOCR'

  async controlChoices(action: 'reset' | 'enable' | 'disable'): Promise<void> {
    const response = await fetchWithTimeout(`${serviceUrl}/choices/${action}`, { method: 'POST' }, 3_000)
    if (!response.ok) throw new Error('选牌监听操作失败，请重启新版识别服务')
  }

  async setFollow(enabled: boolean): Promise<void> {
    const response = await fetchWithTimeout(`${serviceUrl}/follow/${enabled ? 'start' : 'pause'}`, { method: 'POST' }, 3_000)
    if (!response.ok) throw new Error('持续跟随切换失败，请重启新版识别服务')
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${serviceUrl}/health`, undefined, 1_200)
      return response.ok
    } catch {
      return false
    }
  }

  async captureAndRecognize(): Promise<RecognitionSnapshot> {
    const response = await fetchWithTimeout(`${serviceUrl}/capture-recognize`, { method: 'POST' })
    const payload = await readResponse(response)
    return { ...payload.snapshot, diagnostics: payload.diagnostics }
  }

  async triggerCapture(): Promise<void> {
    const response = await fetchWithTimeout(`${serviceUrl}/trigger-capture`, { method: 'POST' }, 3_000)
    if (!response.ok) throw new Error('无法触发截图，请重启最新版识别服务后再试')
  }

  async readHotkeyRecognition(afterSequence: number, sessionId?: string): Promise<HotkeyRecognitionEvent> {
    const response = await fetchWithTimeout(`${serviceUrl}/hotkey-recognition`, undefined, 2_000)
    const payload = await response.json() as HotkeyRecognitionResponse
    if (!response.ok) {
      throw new Error(payload.error ?? `识别服务返回 ${response.status}`)
    }
    const event: HotkeyRecognitionEvent = {
      choices: payload.choices,
      follow: payload.follow,
      elapsedMs: payload.elapsedMs,
      triggerSource: payload.triggerSource,
      sequence: payload.sequence,
      sessionId: payload.sessionId,
      status: payload.status,
      hotkeyRegistered: payload.hotkeyRegistered,
      hotkeyError: payload.hotkeyError,
    }
    const sameSession = payload.sessionId === sessionId
    if ((sameSession && payload.sequence <= afterSequence) || payload.status === 'idle' || payload.status === 'recognizing') return event
    if (payload.status === 'failed') {
      return { ...event, error: payload.error ?? '快捷键识别失败' }
    }
    if (!payload.result) return event
    if (payload.triggerSource === 'continuous-follow' && (!payload.follow?.enabled || payload.followGeneration !== payload.follow.generation)) return event
    return {
      ...event,
      snapshot: { ...payload.result.snapshot, diagnostics: payload.result.diagnostics },
    }
  }

  async recognizeImage(file: File): Promise<RecognitionSnapshot> {
    const response = await fetchWithTimeout(`${serviceUrl}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    const payload = await readResponse(response)
    return { ...payload.snapshot, diagnostics: payload.diagnostics }
  }
}

export const localScreenRecognitionProvider = new LocalScreenRecognitionProvider()
