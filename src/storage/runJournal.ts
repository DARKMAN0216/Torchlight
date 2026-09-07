import { invoke, isTauri } from '@tauri-apps/api/core'
import { validateJournal, type JournalEvent, type RecordedRun } from '../learning/clientRecorder'

const prefix = 'vorax-recording-event-v1:'
export interface RunListing { runId: string; eventCount: number; modifiedMs: number }
export async function saveRecordingEvent(event: JournalEvent): Promise<void> {
  const raw = JSON.stringify(event)
  if (isTauri()) return invoke('save_recording_event', { runId: event.runId, eventId: event.id, raw })
  const key = `${prefix}${event.runId}:${event.id}`, old = localStorage.getItem(key)
  if (old !== null && old !== raw) throw new Error('记录冲突，拒绝覆盖')
  localStorage.setItem(key, raw)
}
function browserEvents(): JournalEvent[] {
  return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => JSON.parse(localStorage.getItem(key)!))
}
export async function listRecordedRuns(): Promise<RunListing[]> {
  if (isTauri()) return invoke('list_recorded_runs')
  const list = new Map<string, RunListing>()
  for (const e of browserEvents()) {
    const row = list.get(e.runId) ?? { runId: e.runId, eventCount: 0, modifiedMs: 0 }
    row.eventCount++; row.modifiedMs = Math.max(row.modifiedMs, Date.parse(e.recordedAt)); list.set(e.runId, row)
  }
  return [...list.values()].sort((a,b) => b.modifiedMs - a.modifiedMs)
}
export async function readRecordedRun(runId: string): Promise<RecordedRun> {
  const events: JournalEvent[] = isTauri() ? (await invoke<string[]>('read_recorded_run', { runId })).map(raw => JSON.parse(raw))
    : browserEvents().filter(e => e.runId === runId)
  const run = { runId, events: events.sort((a,b) => a.sequence - b.sequence) }
  validateJournal(run); return run
}
export function downloadRecording(name: string, value: string) {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
