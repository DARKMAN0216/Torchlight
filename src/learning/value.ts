import { featureNames, type ValueSample } from './dataset'

export interface LearnedValueModel {
  schemaVersion: 1
  modelVersion: string
  algorithm: 'episode-knn-v1'
  featureNames: string[]
  trainingRunIds: string[]
  means: number[]
  scales: number[]
  samples: ValueSample[]
  limitations: string[]
}
function validateSample(s: ValueSample) {
  if (!s.runId || !s.frameId || !s.cohort || !['train', 'validation', 'test'].includes(s.split)
    || s.features.length !== featureNames.length || !s.features.every(Number.isFinite)
    || !Number.isSafeInteger(s.finalActivity) || s.finalActivity < 0) throw new Error('价值样本无效')
}
function validateSamples(samples: ValueSample[]) {
  const rows = new Set<string>(), assignments = new Map<string, string>(), outcomes = new Map<string, number>()
  for (const s of samples) {
    validateSample(s)
    const key = JSON.stringify([s.runId, s.frameId])
    if (rows.has(key)) throw new Error('重复训练行')
    rows.add(key)
    if (assignments.has(s.runId) && assignments.get(s.runId) !== s.split) throw new Error('同一牌局跨训练/评测集泄漏')
    assignments.set(s.runId, s.split)
    if (outcomes.has(s.runId) && outcomes.get(s.runId) !== s.finalActivity) throw new Error('同一牌局终局标签冲突')
    outcomes.set(s.runId, s.finalActivity)
  }
}
/** Small non-parametric learned baseline; no hand-coded card scores and no online policy replacement. */
export function fitValueModel(samples: ValueSample[], modelVersion: string): LearnedValueModel {
  validateSamples(samples)
  const train = samples.filter(s => s.split === 'train')
  const ids = [...new Set(train.map(s => s.runId))].sort()
  if (ids.length < 2) throw new Error('至少需要2场训练集完整牌局；不足时阻断，不用模拟终局补标签')
  if (!modelVersion.trim()) throw new Error('需要明确模型版本')
  // Each episode has equal total weight, irrespective of captures/redraw count.
  const counts = new Map(ids.map(id => [id, train.filter(s => s.runId === id).length]))
  const average = (f: (s: ValueSample) => number) => train.reduce((n, s) => n + f(s) / counts.get(s.runId)!, 0) / ids.length
  const means = featureNames.map((_, i) => average(s => s.features[i]))
  const scales = means.map((m, i) => Math.sqrt(average(s => (s.features[i] - m) ** 2)) || 1)
  return { schemaVersion: 1, modelVersion, algorithm: 'episode-knn-v1', featureNames: [...featureNames],
    trainingRunIds: ids, means, scales, samples: structuredClone(train), limitations: [
      '最近邻经验价值基线，不是神经网络或强化学习策略。',
      '仅估计已记录行为策略下的终局活性，不能用来证明某张牌更优。',
      '要求版本/常驻年龄/候选/阶段/重抽一致；缺相似实战时拒绝估值。',
      '模型含训练局面样本，属于个人对局数据，不应默认上传GitHub。',
    ] }
}
export function predictValue(model: LearnedValueModel, sample: ValueSample, k = 3) {
  validateSample(sample)
  if (!Number.isInteger(k) || k < 1) throw new Error('k无效')
  const candidates = model.samples.filter(s => s.cohort === sample.cohort && s.runId !== sample.runId)
    .map(s => ({ s, distance: s.features.reduce((sum, v, i) => sum + ((v - sample.features[i]) / model.scales[i]) ** 2, 0) / featureNames.length }))
    .filter(c => c.distance <= 4)
    .sort((a, b) => a.distance - b.distance || a.s.runId.localeCompare(b.s.runId))
  const used = new Set<string>()
  // At most one nearest state from each training run: repeated F8 cannot dominate the estimate.
  const neighbors = candidates.filter(c => !used.has(c.s.runId) && Boolean(used.add(c.s.runId))).slice(0, k)
  if (neighbors.length < 2) return { status: 'blocked' as const, reason: '同上下文且距离在实验阈值内的独立训练牌局不足2场' }
  return { status: 'estimated' as const, value: neighbors.reduce((n, c) => n + c.s.finalActivity, 0) / neighbors.length,
    neighborRunIds: neighbors.map(n => n.s.runId), nearestDistance: neighbors[0].distance }
}
export function evaluateValueModel(model: LearnedValueModel, samples: ValueSample[], split: 'validation' | 'test' = 'test') {
  validateSamples(samples)
  const heldout = samples.filter(s => s.split === split)
  if (heldout.some(s => model.trainingRunIds.includes(s.runId))) throw new Error('整局泄漏：评测集包含训练牌局')
  const rows = heldout.map(sample => {
    const prediction = predictValue(model, sample)
    return { runId: sample.runId, frameId: sample.frameId, prediction,
      absoluteError: prediction.status === 'estimated' ? Math.abs(prediction.value - sample.finalActivity) : null }
  })
  const groups = new Map<string, number[]>()
  rows.forEach(r => { if (r.absoluteError !== null) groups.set(r.runId, [...(groups.get(r.runId) ?? []), r.absoluteError]) })
  const episodeErrors = [...groups.values()].map(errors => errors.reduce((a, b) => a + b, 0) / errors.length)
  return { split, rows, heldoutRuns: new Set(heldout.map(s => s.runId)).size,
    estimatedRows: rows.filter(r => r.absoluteError !== null).length,
    blockedRows: rows.filter(r => r.absoluteError === null).length,
    episodeMeanAbsoluteError: episodeErrors.length ? episodeErrors.reduce((a, b) => a + b, 0) / episodeErrors.length : null,
    status: episodeErrors.length ? 'evaluated' : 'insufficient-data',
    note: '离线行为价值误差，不是推荐胜率或终局收益提升；不足样本/无匹配不计作零误差。' }
}
