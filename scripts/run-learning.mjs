import { build } from 'vite'
import { readFile, mkdir, readdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await build({ root, configFile: false, logLevel: 'error', build: {
  ssr: resolve(root, 'src/learning/index.ts'), outDir: resolve(root, 'work/learning-runtime'), emptyOutDir: false,
  rollupOptions: { output: { entryFileNames: 'learning.mjs' } },
} })
const api = await import(pathToFileURL(resolve(root, 'work/learning-runtime/learning.mjs')).href)
const args = process.argv.slice(2)
const option = (key) => {
  const index = args.indexOf(key)
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(key + '缺少参数')
  return args[index + 1]
}
const output = option('--output')
const saveNew = async (path, content) => {
  await mkdir(dirname(path), { recursive: true })
  // Explicitly refuse overwriting evidence or model artifacts, including on reruns.
  const file = await open(path, 'wx')
  try { await file.writeFile(content); await file.sync() } finally { await file.close() }
}
const loadRuns = async (path) => api.parseArchives(await readFile(resolve(path), 'utf8'))
let result
if (args[0] === 'verify') {
  const verification = api.verifyLearningPipeline()
  result = verification.report
  const dir = option('--artifacts')
  if (dir) {
    // A new directory is required; no existing run or personal storage can be replaced.
    await mkdir(resolve(dir))
    await saveNew(resolve(dir, 'historical.jsonl'), api.serializeArchives([verification.historical]))
    await saveNew(resolve(dir, 'synthetic.jsonl'), api.serializeArchives(verification.synthetic))
    await saveNew(resolve(dir, 'synthetic-model.json'), JSON.stringify(verification.model, null, 2))
    await saveNew(resolve(dir, 'verification.json'), JSON.stringify(result, null, 2))
  }
} else if (args[0] === 'audit' && args[1]) {
  const runs = await loadRuns(args[1])
  const dataset = api.buildValueDataset(runs)
  result = { audit: api.classifyRuns(runs), dataset: { rows: dataset.samples.length,
    excluded: dataset.excluded, labelMeaning: dataset.labelMeaning } }
} else if (args[0] === 'archive' && args[1] && option('--directory')) {
  const runs = await loadRuns(args[1])
  const directory = resolve(option('--directory'))
  await mkdir(directory, { recursive: true })
  const files = []
  for (const run of runs) {
    // IDs are never interpreted as filesystem paths; content-addressed revisions retain history.
    const content = api.serializeArchives([run])
    const id = createHash('sha256').update(run.runId).digest('hex')
    const revision = createHash('sha256').update(content).digest('hex')
    const path = join(directory, `${id}-${revision}.jsonl`)
    try { await saveNew(path, content) } catch (error) {
      if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error
    }
    files.push({ runId: run.runId, path, revision })
  }
  result = { files, note: '不可变修订已保存；同runId不同修订保留。统计时须明确选择一个修订，不能按多场计数。' }
} else if (args[0] === 'list' && args[1]) {
  const directory = resolve(args[1])
  result = { files: (await readdir(directory)).filter(f => /^[a-f0-9]{64}-[a-f0-9]{64}\.jsonl$/.test(f)) }
} else if (args[0] === 'train' && args[1] && output) {
  const runs = await loadRuns(args[1]), dataset = api.buildValueDataset(runs)
  if (runs.some(r => r.provenance === 'synthetic') && runs.some(r => r.provenance === 'real'))
    throw new Error('训练禁止混合实战与合成数据；分别验证')
  try {
    const model = api.fitValueModel(dataset.samples, option('--version') ?? 'observational-value-v1')
    result = { model, datasetSummary: { rows: dataset.samples.length, excluded: dataset.excluded },
      validation: api.evaluateValueModel(model, dataset.samples, 'validation'),
      test: api.evaluateValueModel(model, dataset.samples, 'test'),
      note: '经验价值实验产物，不自动安装或替换推荐，不作为卡牌最优标签。' }
  } catch (error) {
    result = { status: 'blocked', reason: String(error), rows: dataset.samples.length, excluded: dataset.excluded }
    process.exitCode = 2
  }
} else throw new Error('用法：pnpm learning verify [--artifacts 新目录] | audit 输入.jsonl | archive 输入.jsonl --directory 归档目录 | list 归档目录 | train 输入.jsonl --output 新文件 [--version 版本]；所有命令可用--output保存报告')
if (output) {
  await saveNew(resolve(output), JSON.stringify(result, null, 2) + '\n')
  console.log('已保存（未覆盖旧文件）：' + resolve(output))
} else console.log(JSON.stringify(result, null, 2))
