import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(join(tmpdir(), 'vorax-learning-cli-'))
let checks = 0
function run(args, expected = 0) {
  const result = spawnSync(process.execPath, ['scripts/run-learning.mjs', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
  })
  assert.equal(result.status, expected, `${args[0]}: ${result.stdout}\n${result.stderr}`)
  checks++
  return result
}
const artifacts = join(temp, 'artifacts')
run(['verify', '--artifacts', artifacts, '--output', join(temp, 'report.json')])
const report = JSON.parse(await readFile(join(temp, 'report.json'), 'utf8'))
assert.equal(report.realTrainingRows, 0)
assert.equal(report.synthetic.test.status, 'evaluated')
const historical = join(artifacts, 'historical.jsonl')
run(['audit', historical, '--output', join(temp, 'audit.json')])
assert.equal(JSON.parse(await readFile(join(temp, 'audit.json'), 'utf8')).audit.totals.runs, 1)
const storage = join(temp, 'archive')
run(['archive', historical, '--directory', storage])
run(['archive', historical, '--directory', storage])
assert.equal((await readdir(storage)).length, 1)
const revised = JSON.parse(await readFile(historical, 'utf8'))
revised.end.kind = 'abandoned'
await writeFile(join(temp, 'revised.runs.jsonl'), JSON.stringify(revised) + '\n', { flag: 'wx' })
run(['archive', join(temp, 'revised.runs.jsonl'), '--directory', storage])
assert.equal((await readdir(storage)).length, 2) // no overwrite of original incomplete run
run(['list', storage, '--output', join(temp, 'list.json')])
run(['train', historical, '--output', join(temp, 'blocked.value-model.json')], 2)
assert.equal(JSON.parse(await readFile(join(temp, 'blocked.value-model.json'), 'utf8')).status, 'blocked')
run(['train', join(artifacts, 'synthetic.jsonl'), '--output', join(temp, 'synthetic.value-model.json'), '--version', 'cli-test-v1'])
const modelBefore = await readFile(join(temp, 'synthetic.value-model.json'), 'utf8')
assert.equal(JSON.parse(modelBefore).model.modelVersion, 'cli-test-v1')
run(['train', join(artifacts, 'synthetic.jsonl'), '--output', join(temp, 'synthetic.value-model.json')], 1)
assert.equal(await readFile(join(temp, 'synthetic.value-model.json'), 'utf8'), modelBefore)
await writeFile(join(temp, 'invalid.runs.jsonl'), '{"schemaVersion":1}\n', { flag: 'wx' })
run(['archive', join(temp, 'invalid.runs.jsonl'), '--directory', storage], 1)
assert.equal((await readdir(storage)).length, 2)
run(['verify', '--artifacts', artifacts], 1)
console.log(JSON.stringify({ status: 'passed', subprocessChecks: checks, temp,
  note: '仅临时目录，无用户存档/服务/窗口访问；临时证据保留便于核验。' }, null, 2))
