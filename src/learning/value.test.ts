import { describe, expect, it } from 'vitest'
import { buildValueDataset, type ValueSample } from './dataset'
import { evaluateValueModel, fitValueModel, predictValue } from './value'
import { importHistoricalRun, syntheticTrainingRuns, verifyLearningPipeline } from './verification'

const data = () => buildValueDataset(syntheticTrainingRuns(40)).samples
describe('offline observational value learning proof', () => {
  it('fits from data and evaluates only independent held-out runs', () => {
    const rows = data(), model = fitValueModel(rows, 'test-v1')
    const report = evaluateValueModel(model, rows)
    expect(model.samples.every(s => s.split === 'train')).toBe(true)
    expect(report.heldoutRuns).toBeGreaterThan(0)
    expect(report.estimatedRows).toBeGreaterThan(0)
    expect(report.episodeMeanAbsoluteError).not.toBeNull()
    expect(report.rows.every(r => !model.trainingRunIds.includes(r.runId))).toBe(true)
  })
  it('rejects real training without observed terminal outcomes', () => {
    const rows = buildValueDataset([importHistoricalRun()]).samples
    expect(() => fitValueModel(rows, 'not-ready')).toThrow('完整牌局')
  })
  it('new labels update the learned estimate, without manually changing card scores', () => {
    const rows = data(), test = rows.find(s => s.split === 'test')!
    const first = predictValue(fitValueModel(rows, 'v1'), test)
    const changed = rows.map(s => ({ ...s, finalActivity: s.split === 'train' ? s.finalActivity + 500 : s.finalActivity }))
    const second = predictValue(fitValueModel(changed, 'v2'), test)
    expect(first.status).toBe('estimated'); expect(second.status).toBe('estimated')
    if (first.status === 'estimated' && second.status === 'estimated') expect(second.value - first.value).toBe(500)
  })
  it('normalization uses only training data and does not leak test features', () => {
    const rows = data(), first = fitValueModel(rows, 'v1')
    const changed = rows.map(s => s.split === 'train' ? s : ({ ...s, features: s.features.map(v => v + 9999) }))
    const second = fitValueModel(changed, 'v2')
    expect(second.means).toEqual(first.means); expect(second.scales).toEqual(first.scales)
  })
  it('detects run-level leakage, duplicate rows and invalid labels', () => {
    const rows = data(), train = rows.find(s => s.split === 'train')!
    expect(() => fitValueModel([...rows, train], 'v1')).toThrow('重复')
    const leak = { ...train, frameId: 'other', split: 'test' as const }
    expect(() => fitValueModel([...rows, leak], 'v1')).toThrow('泄漏')
    expect(() => evaluateValueModel(fitValueModel(rows, 'v1'), [leak])).toThrow('泄漏')
    expect(() => fitValueModel([{ ...train, finalActivity: NaN }], 'v1')).toThrow('无效')
  })
  it('rejects inconsistent terminal labels within the same run', () => {
    const rows = data()
    rows[0].finalActivity++
    expect(() => fitValueModel(rows, 'v1')).toThrow('标签冲突')
  })
  it('does not mix unrelated versions, passive/offer contexts or extrapolate far away', () => {
    const rows = data(), test = structuredClone(rows.find(s => s.split === 'test')!)
    const model = fitValueModel(rows, 'v1')
    expect(predictValue(model, { ...test, cohort: 'unknown-card-context' }).status).toBe('blocked')
    expect(predictValue(model, { ...test, features: test.features.map(v => v + 10000) }).status).toBe('blocked')
  })
  it('uses independent neighboring runs rather than multiple frames of one run', () => {
    const rows = data(), test = rows.find(s => s.split === 'test')!
    const prediction = predictValue(fitValueModel(rows, 'v1'), test)
    expect(prediction.status).toBe('estimated')
    if (prediction.status === 'estimated') expect(new Set(prediction.neighborRunIds).size).toBe(prediction.neighborRunIds.length)
  })
  it('reports insufficient data instead of a zero-error empty evaluation', () => {
    const rows = data(), model = fitValueModel(rows, 'v1')
    expect(evaluateValueModel(model, []).episodeMeanAbsoluteError).toBeNull()
    expect(evaluateValueModel(model, []).status).toBe('insufficient-data')
  })
  it('preserves predictions through JSON serialization of the learned artifact', () => {
    const rows = data(), test = rows.find(s => s.split === 'test')!, model = fitValueModel(rows, 'v1')
    expect(predictValue(JSON.parse(JSON.stringify(model)), test)).toEqual(predictValue(model, test))
  })
  it('validates sample feature dimension, split and neighbor count', () => {
    const rows = data(), model = fitValueModel(rows, 'v1')
    expect(() => predictValue(model, { ...rows[0], features: [] })).toThrow('无效')
    expect(() => fitValueModel([{ ...rows[0], split: 'bogus' } as unknown as ValueSample], 'v1')).toThrow('无效')
    expect(() => predictValue(model, rows[0], 0)).toThrow('k无效')
  })
  it('returns honest technical-verification scope, not a deployed trained policy', () => {
    const { report } = verifyLearningPipeline()
    expect(report.realTrainingRows).toBe(0)
    expect(report.synthetic.test.status).toBe('evaluated')
    expect(report.deploymentDecision).toContain('not-ready')
  })
})
