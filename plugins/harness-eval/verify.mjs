/**
 * Runtime checks for dsh-harness-eval.
 *
 * Two independent things are verified, because they fail in different ways:
 *
 *   1. **The projection mounted.** A missing row means the unit never registered
 *      in the running process, so the tab would render empty forever.
 *   2. **Two readers of the same log agree.** `vendor/session-usage.js` and
 *      `lib/reader.js` both decompress the frame-per-line session log, and a
 *      disagreement means one is losing events. That is the exact failure this
 *      plugin vendored code to avoid: `zlib.zstdDecompressSync` returns only the
 *      first frame of a multi-frame buffer and does not throw, so a naive reader
 *      silently reports a fraction of the truth.
 *
 *   node verify.mjs               # projection presence + reader agreement
 *   node verify.mjs --readers     # reader agreement only, no cache needed
 *   node verify.mjs --limit 20    # fast pass over the newest 20 sessions
 *   node verify.mjs --home <dir>
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSessionLogs, readSessionLog } from './lib/reader.js'
import { isBreakdown } from './lib/evidence.js'

const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const KEY = 'harnessEvidence'

/**
 * Parse the command line.
 * @param argv - arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv) {
  const options = { home: HOME, limit: 0, readersOnly: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--readers') {
      options.readersOnly = true
    } else if (arg === '--limit' || arg === '--home') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      if (arg === '--limit') options.limit = Number(value)
      else options.home = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node verify.mjs [--readers] [--limit <n>] [--home <dir>]')
      process.exit(0)
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return options
}

/**
 * Load the projection definition without mounting Cordis.
 * @param plugin - the host plugin module.
 * @returns the registered definition.
 */
function projectionDefinition(plugin) {
  let definition
  plugin.apply({
    sessionProjections: { register: (value) => { definition = value; return () => {} } },
    plugin: () => {},
    get: () => undefined,
    effect: () => () => {},
  })
  if (definition === undefined) throw new Error('the plugin did not register a projection definition')
  return definition
}

/**
 * Refold decoded events, skipping duplicate seqs.
 * @param events - decoded events, header first.
 * @param definition - the projection definition.
 * @returns the folded state.
 */
function refold(events, definition) {
  const header = events[0]
  let state = definition.init(header)
  const seen = new Set()
  for (const event of events) {
    if (event === header) continue
    if (typeof event.seq === 'number') {
      if (seen.has(event.seq)) continue
      seen.add(event.seq)
    }
    state = definition.apply(state, event)
  }
  return state
}

/**
 * Check that both readers decode every session log to the same events.
 * @param options - resolved CLI options.
 * @param vendor - the vendored module.
 * @returns the number of problems found.
 */
function checkReaders(options, vendor) {
  const logs = findSessionLogs(options.home)
  const targeted = options.limit > 0 ? logs.slice(-options.limit) : logs
  console.log(`readers: comparing ${targeted.length} of ${logs.length} log(s) under ${resolve(options.home)}`)
  let problems = 0
  let frames = 0
  for (const found of targeted) {
    let own
    try {
      own = readSessionLog(found.path)
    } catch (error) {
      console.error(`  ${found.sessionId}: reader.js failed: ${error instanceof Error ? error.message : String(error)}`)
      problems += 1
      continue
    }
    let vendorLines = 0
    try {
      vendor.forEachFrame(readFileSync(found.path), text => {
        for (const line of text.split('\n')) if (line !== '') vendorLines += 1
      })
    } catch (error) {
      console.error(`  ${found.sessionId}: vendor walk failed: ${error instanceof Error ? error.message : String(error)}`)
      problems += 1
      continue
    }
    frames += own.length
    if (vendorLines !== own.length) {
      console.error(`  ${found.sessionId}: ${own.length} lines (reader.js) != ${vendorLines} (vendor)`)
      problems += 1
    }
  }
  console.log(`readers: ${frames.toLocaleString()} event(s) agreed across ${targeted.length - problems} log(s)`)
  return problems
}

/**
 * Check the projection cache for the evidence row.
 * @param options - resolved CLI options.
 * @param definition - the projection definition.
 * @returns the number of problems found, or 2 codes for "not mounted".
 */
function checkProjection(options, definition) {
  const cacheDir = join(options.home, 'storages', 'session_projcache', 'sessions')
  let names
  try {
    names = readdirSync(cacheDir).filter(name => name.endsWith('.json'))
  } catch (error) {
    console.error(`cannot read projection cache at ${cacheDir}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  let hits = 0
  let stale = 0
  let newestWithTurns
  let badFork = 0
  for (const name of names) {
    let record
    try {
      record = JSON.parse(readFileSync(join(cacheDir, name), 'utf8'))
    } catch {
      continue
    }
    const row = record?.record?.rows?.[KEY]
    if (row === undefined) continue
    hits += 1
    if (row.ver !== definition.stateVersion) {
      stale += 1
      continue
    }
    const view = definition.wire.view(row.val)
    if (newestWithTurns === undefined && view.totals.turns > 0) {
      newestWithTurns = { name, view, row }
    }
    if (view.totals.turns === 0) continue
    // The invariant that changed in version 5: an interruption is a person
    // stopping the run, never a breakdown to fork from.
    const allStopped = view.turns.every(turn => turn.outcome !== undefined && !isBreakdown(turn.outcome))
    if (allStopped && view.bifurcate.turn !== null) {
      badFork += 1
      console.error(`  ${name}: interrupt-only session reported fork point ${view.bifurcate.turn}`)
    }
    console.log(`\n${name}`)
    console.log(`  ver=${row.ver} seq=${row.seq} turns=${view.totals.turns}`)
    console.log(`  tokens in=${view.totals.inputTokens.toLocaleString()} out=${view.totals.outputTokens.toLocaleString()} cacheRead=${view.totals.cacheReadTokens.toLocaleString()}`)
    console.log(`  calls=${view.totals.toolCalls} errors=${view.totals.toolErrors} retries=${view.retries} repeats=${view.repeats}`)
    console.log(`  fork=${view.bifurcate.turn === null ? 'none' : `turn ${view.bifurcate.turn}`} tailSteps=${view.bifurcate.tailSteps} tailTokenShare=${view.bifurcate.tailTokenShare ?? 'n/a'}`)
    if (view.signature !== undefined) {
      console.log(`  signature tools=${view.signature.toolCount} toolsHash=${view.signature.toolsHash} promptChars=${view.signature.promptChars} ${view.signature.provider}/${view.signature.model}`)
    }
  }
  if (hits === 0) {
    console.log(`\nMISSING: no "${KEY}" row in ${names.length} session caches.`)
    console.log('The unit is not registered in the running process.')
    return 2
  }
  console.log(`\nprojection: "${KEY}" present in ${hits}/${names.length} session cache(s), ${stale} from an older version.`)
  if (newestWithTurns !== undefined) {
    console.log(`Newest session with turns: ${newestWithTurns.name} (${newestWithTurns.view.totals.turns} turns).`)
  }
  return badFork
}

/**
 * Run both checks.
 * @param argv - arguments after the script path.
 * @returns the process exit code.
 */
async function main(argv) {
  const options = parseArgs(argv)
  const plugin = await import(new URL('./lib/index.js', import.meta.url))
  const definition = projectionDefinition(plugin)
  let vendor
  try {
    vendor = await import(new URL('./vendor/session-usage.js', import.meta.url))
  } catch {
    console.error('cannot load vendor/session-usage.js; the reader cross-check needs it')
    return 1
  }
  const readerProblems = checkReaders(options, vendor)
  if (options.readersOnly) return readerProblems === 0 ? 0 : 1
  const projectionProblems = checkProjection(options, definition)
  if (projectionProblems === 2) return 2
  return readerProblems === 0 && projectionProblems === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
