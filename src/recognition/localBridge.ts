import type { RecognitionSnapshot, ScreenRecognitionProvider } from './contracts'

const serviceUrl = 'http://127.0.0.1:28765'

interface LocalRecognitionResponse {
  snapshot: RecognitionSnapshot
  diagnostics?: RecognitionSnapshot['diagnostics']
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
