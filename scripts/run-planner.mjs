import { build } from 'vite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Existing Vite toolchain bundles TS and the local raw card table; no runtime dependency is added.
await build({
  root, configFile: false, logLevel: 'error',
  build: { ssr: resolve(root, 'src/planner/index.ts'), outDir: resolve(root, 'work/planner-runtime'),
    emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'planner.mjs' } } },
})
const planner = await import(pathToFileURL(resolve(root, 'work/planner-runtime/planner.mjs')).href)
const args = process.argv.slice(2)
const command = args[0] ?? 'demo'
const outputIndex = args.indexOf('--output')
let result
if (command === 'demo') {
  const { state, model } = planner.createDemo()
  result = { label: '合成局面/限制牌池演示', input: { state, model },
    report: planner.recommend(state, model, { simulations: 32, policyDepth: 1, maxTransitions: 250000 }),
    orderSensitivity: planner.checkOrderSensitivity(state, model, { simulations: 16, policyDepth: 0 }) }
} else if (command === 'coverage') {
  result = planner.modelCoverage(planner.createPlannerModel())
} else if (command === 'recommend' && args[1] && !args[1].startsWith('--')) {
  const input = JSON.parse(await readFile(resolve(args[1]), 'utf8'))
  const model = planner.createPlannerModel(input.model ?? {})
  result = planner.recommend(input.state, model, input.search ?? {})
} else {
  throw new Error('用法：pnpm planner demo | coverage | recommend 输入.json [--output 输出.json]')
}
const json = JSON.stringify(result, null, 2) + '\n'
if (outputIndex >= 0) {
  if (!args[outputIndex + 1]) throw new Error('--output 缺少路径')
  const path = resolve(args[outputIndex + 1])
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, json, 'utf8')
  console.log('已保存：' + path)
  const report = result.report ?? result
  if (report.status) console.log(JSON.stringify({ status: report.status, recommendation: report.recommendation,
    transitions: report.transitions, elapsedMs: report.elapsedMs, issues: report.issues }))
} else console.log(json)
if (result.status && result.status !== 'complete') process.exitCode = 2
