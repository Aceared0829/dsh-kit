/**
 * Run every verification suite and report one combined result.
 *
 *   node test/run-all.mjs
 *
 * test/verify.mjs runs with no DSH dependency at all: fakes for the context, the
 * agent, the session and the clock. The other two drive the real production plugins
 * from the DSH checkout through the dev junctions in node_modules (see README).
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const suites = [
  ['verify.mjs', 'unit - fake context, deterministic clock'],
  ['integration.mjs', 'integration - real AgentLoop from the checkout'],
  ['persistence.mjs', 'persistence - real JSONL round-trip'],
]

let failedSuites = 0
const summary = []

for (const [file, description] of suites) {
  console.log('='.repeat(72))
  console.log(file + '  (' + description + ')')
  console.log('='.repeat(72))
  const result = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' })
  const status = result.status ?? 1
  if (status !== 0) failedSuites += 1
  summary.push({ file, status })
  console.log('')
}

console.log('='.repeat(72))
for (const entry of summary) {
  console.log((entry.status === 0 ? 'PASS  ' : 'FAIL  ') + entry.file + '  (exit ' + entry.status + ')')
}
console.log('='.repeat(72))
if (failedSuites > 0) {
  console.log(failedSuites + ' of ' + suites.length + ' suites failed')
  process.exitCode = 1
} else {
  console.log('All ' + suites.length + ' suites passed.')
}
