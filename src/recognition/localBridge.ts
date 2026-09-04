import type { RecognitionSnapshot, ScreenRecognitionProvider } from './contracts'

const serviceUrl = 'http://127.0.0.1:28765'

interface LocalRecognitionResponse {
  snapshot: RecognitionSnapshot
  diagnostics?: RecognitionSnapshot['diagnostics']
  error?: string
}

interface HotkeyRecognitionResponse {
  sequence: number
  status: 'idle' | 'recognizing' | 'completed' | 'failed'
  result: LocalRecognitionResponse | null
  error: string | null
}

export interface HotkeyRecognitionEvent {
  sequence: number
  snapshot?: RecognitionSnapshot
  error?: string
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
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

  async readHotkeyRecognition(afterSequence: number): Promise<HotkeyRecognitionEvent | null> {
    const response = await fetchWithTimeout(`${serviceUrl}/hotkey-recognition`, undefined, 2_000)
    const payload = await response.json() as HotkeyRecognitionResponse
    if (!response.ok) {
      throw new Error(payload.error ?? `识别服务返回 ${response.status}`)
    }
    if (payload.sequence <= afterSequence || payload.status === 'idle' || payload.status === 'recognizing') {
      return null
    }
    if (payload.status === 'failed') {
      return { sequence: payload.sequence, error: payload.error ?? '快捷键识别失败' }
    }
    if (!payload.result) return null
    return {
      sequence: payload.sequence,
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
