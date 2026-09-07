import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }))
vi.mock('@tauri-apps/api/core', () => mocks)
import { listRecordedRuns, readRecordedRun, saveRecordingEvent } from './runJournal'
import type { JournalEvent } from '../learning/clientRecorder'
const event: JournalEvent = { schemaVersion: 1, runId: 'run-1', id: 'event-1', sequence: 1, recordedAt: '2026-09-07T01:00:00Z', type: 'start', reason: 'first-capture', gameVersion: 'unknown', rulesVersion: 'client-recorder-v1' }
beforeEach(() => { mocks.invoke.mockReset(); mocks.isTauri.mockReturnValue(true) })
it('writes only the independent native recording API', async () => {
  await saveRecordingEvent(event)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  expect(mocks.invoke).toHaveBeenCalledWith('save_recording_event', { runId: 'run-1', eventId: 'event-1', raw: JSON.stringify(event) })
})
it('propagates old-client command errors rather than claiming durable success', async () => {
  mocks.invoke.mockRejectedValue(new Error('unknown command'))
  await expect(saveRecordingEvent(event)).rejects.toThrow('unknown command')
})
it('sorts disk events by sequence and detects missing events', async () => {
  const end: JournalEvent = { ...event, id: 'event-2', sequence: 2, type: 'end', reason: '未完成' }
  mocks.invoke.mockResolvedValue([JSON.stringify(end), JSON.stringify(event)])
  expect((await readRecordedRun('run-1')).events).toEqual([event, end])
  mocks.invoke.mockResolvedValue([JSON.stringify(end)])
  await expect(readRecordedRun('run-1')).rejects.toThrow('缺失')
})
it('rejects corrupt history without touching other storage', async () => {
  mocks.invoke.mockResolvedValue(['broken'])
  await expect(readRecordedRun('run-1')).rejects.toThrow()
  expect(mocks.invoke.mock.calls.every(([cmd]) => cmd === 'read_recorded_run')).toBe(true)
})
it('lists previous runs without requiring workspace/localStorage', async () => {
  const list = [{ runId: 'run-1', eventCount: 1, modifiedMs: 1 }]
  mocks.invoke.mockResolvedValue(list)
  expect(await listRecordedRuns()).toEqual(list)
})
