/**
 * `npm run loop` — the closed loop, as one command.
 *
 * This is the only entry point that spans every stage, so it is also the one
 * that must be honest about what it could not decide. A loop that stayed quiet
 * while returning `inconclusive` would read as a working system that happens to
 * be idle.
 *
 * ## Why this is a command and not only a plugin
 *
 * The same capabilities also run inside the Harness (`src/index.js`). That
 * placement has one cost the loop cannot afford: the Host loads a plugin's
 * `lib/` once, and HMR ignores `node_modules`, where the plugin actually lives.
 * Every change therefore needed a restart — a self-improving loop whose own
 * improvement needs a human to restart the process is not a loop.
 *
 * This script touches no Host API. Observe reads session logs, judge is
 * arithmetic, act writes one skill file and appends to a ledger. So it works
 * with the app closed, and its own edits take effect on the next call, because
 * a skill is read from disk on every use.
 *
 * What stays in the plugin: anything that must happen DURING a tool call — the
 * repeat-observation guard needs the Host's dispatch pipeline. This file covers
 * everything that happens AROUND calls.
 *
 * ## Commands
 *
 *   node loop.mjs --status                  what is in force, with verdicts
 *   node loop.mjs --judge <change-id>       measure, decide, act
 *   node loop.mjs --judge <id> --dry-run    decide without writing anything
 *   node loop.mjs --revert <change-id>      undo a change by hand
 *   node loop.mjs --probe                   raw readings, no judgement
 *   node loop.mjs --candidates              rank observed signals by coverage
 *
 * Exit codes: 0 done, 2 nothing to decide, 1 error.
 */

import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inForce, readLedger, revertChange } from './src/ledger.js'
import { iterate, status } from './src/loop.js'
import { judge } from './src/verdict.js'
import { measureWindow } from './s3/probe.mjs'
import { rankCandidates } from './src/candidates.js'

/**
 * Ledger location used by this plugin.
 *
 * `HARNESS_LEDGER` overrides it; otherwise it sits under the current working
 * directory, so the plugin carries no machine-specific path.
 */
const DEFAULT_LEDGER = join(process.cwd(), 'reports', 'harness-eval-ledger')
/**
 * The ONLY directories an automated action may write inside.
 *
 * Skills have both properties that matter: a person can read a diff of the
 * change, and the next call reads the file from disk — so the change takes
 * effect without restarting anything. Widening this list would hand the loop the
 * power to require a restart, which is the defect it exists to remove.
 *
 * `HARNESS_SKILL_ROOTS` (a `path.delimiter`-separated list) overrides the
 * default, which resolves the DSH checkout from `DSH_CHECKOUT`, falling back to
 * the current working directory. If that path does not exist, every automated
 * write is refused — the safe direction.
 */
const DEFAULT_SKILL_ROOT = join(
  process.env.DSH_CHECKOUT ?? process.cwd(),
  'packages', 'preset', 'agent-preset', 'skills',
)
const SKILL_ROOTS = process.env.HARNESS_SKILL_ROOTS
  ? process.env.HARNESS_SKILL_ROOTS.split(delimiter).filter(Boolean)
  : [DEFAULT_SKILL_ROOT]

/**
 * Parse the command line.
 * @param argv - arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv) {
  const options = {
    status: false,
    judge: undefined,
    revert: undefined,
    probe: false,
    candidates: false,
    dryRun: false,
    json: false,
    ledger: process.env.HARNESS_LEDGER ?? DEFAULT_LEDGER,
    home: process.env.DSH_HOME,
  }
  const value = (index, arg) => {
    const next = argv[index]
    if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`)
    return next
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--status') options.status = true
    else if (arg === '--probe') options.probe = true
    else if (arg === '--candidates') options.candidates = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--judge') options.judge = value(++index, arg)
    else if (arg === '--revert') options.revert = value(++index, arg)
    else if (arg === '--ledger') options.ledger = value(++index, arg)
    else if (arg === '--home') options.home = value(++index, arg)
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node loop.mjs [--status | --judge <id> | --revert <id> | --probe | --candidates] [--dry-run] [--json] [--ledger <dir>] [--home <dir>]')
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return options
}

/**
 * The probe adapter the loop calls.
 *
 * It reshapes `measureWindow` into the fields the verdict expects, and is the
 * ONLY place that mapping exists, so the loop and the raw probe can never
 * disagree about what "the metric" is.
 */
const probe = {
  measure(options) {
    const measured = measureWindow(options)
    return {
      sessions: measured.sessions,
      metric: measured.metric,
      cost: measured.cost,
      exposure: measured.exposure,
      guardDenials: measured.guardDenials,
    }
  },
}

/**
 * Report a decision the same way for dry and real runs.
 * @param decision - what `iterate` or the dry path produced.
 */
function report(decision) {
  console.log('')
  console.log(`decision: ${decision.decision}${decision.reason === undefined ? '' : ` (${decision.reason})`}`)
  if (decision.detail !== undefined) console.log(`  ${decision.detail}`)
  if (decision.measurement !== undefined) {
    const { before, after } = decision.measurement
    const show = side => `${side.sessions} session(s), metric ${side.metric}, cost ${side.cost}, exposure ${side.exposure ?? 'n/a'}`
    console.log(`  before: ${show(before)}`)
    console.log(`  after:  ${show(after)}`)
  }
  if (decision.missing !== undefined) console.log(`  ${decision.missing}`)
  if (decision.action !== undefined) console.log(`  action: ${decision.action}`)
}

/**
 * Decide without writing anything.
 *
 * A dry run must reach the same verdict as the real one, so it calls the same
 * pure rule. Only the two writes — the ledger entry and the possible revert —
 * are skipped.
 * @param applied - the change in force.
 * @param home - DSH home to measure.
 * @returns a decision shaped like `iterate`'s, minus the writes.
 */
function dryJudge(applied, home) {
  const boundary = Date.parse(applied.at)
  const before = probe.measure({ home, until: boundary })
  const after = probe.measure({ home, since: boundary })
  const reading = judge({
    before: { sessions: before.sessions, metric: before.metric, cost: before.cost, exposure: before.exposure },
    after: { sessions: after.sessions, metric: after.metric, cost: after.cost, exposure: after.exposure },
  })
  return {
    changeId: applied.id,
    decision: reading.verdict,
    reason: reading.reason,
    detail: reading.detail,
    measurement: {
      before: { sessions: before.sessions, metric: before.metric, cost: before.cost, exposure: before.exposure },
      after: { sessions: after.sessions, metric: after.metric, cost: after.cost, exposure: after.exposure },
      boundary: new Date(boundary).toISOString(),
    },
    action: 'none (dry run)',
  }
}

/**
 * Run the command.
 * @param argv - arguments after the script path.
 * @returns the process exit code.
 */
async function main(argv) {
  const options = parseArgs(argv)

  if (options.status) {
    const rows = status(options.ledger)
    if (options.json) {
      console.log(JSON.stringify(rows, null, 2))
      return 0
    }
    if (rows.length === 0) {
      console.log(`no change recorded in ${resolve(options.ledger)}`)
      return 2
    }
    console.log(`${rows.length} change(s) in ${resolve(options.ledger)}:`)
    for (const row of rows) {
      console.log('')
      console.log(`  ${row.id}  ${row.inForce ? 'IN FORCE' : 'reverted'}`)
      console.log(`    target:  ${row.target}`)
      console.log(`    applied: ${row.appliedAt}`)
      console.log(`    verdict: ${row.verdict ?? 'not judged yet'}${row.reason === null ? '' : ` — ${row.reason}`}`)
    }
    return 0
  }

  if (options.probe) {
    const measured = measureWindow({ home: options.home })
    if (options.json) {
      console.log(JSON.stringify(measured, null, 2))
      return 0
    }
    const summary = measured.summary
    console.log(`sessions with turns: ${summary.sessions} (${summary.sessionsWithGui} touched the GUI)`)
    console.log(`metric (paid GUI repeats): ${summary.guiRepeats} (${summary.guiRepeatShare ?? 'n/a'}% of GUI calls)`)
    console.log(`guard denials (never paid for): ${summary.guardDenials}`)
    console.log(`cost (input tokens): ${summary.inputTokens.toLocaleString()}`)
    return 0
  }

  if (options.candidates) {
    const ranked = rankCandidates({ home: options.home })
    if (options.json) {
      console.log(JSON.stringify(ranked, null, 2))
      return 0
    }
    console.log(`${ranked.sessions} session(s) read; signals ranked by how often they could occur:`)
    for (const row of ranked.rows) {
      if (row.sessions === 0) continue
      console.log('')
      console.log(`  ${row.signal}`)
      console.log(`    sessions: ${row.sessions}/${ranked.sessions} (${row.coverage}%)   occurrences: ${row.occurrences}`)
      console.log(`    ${row.note}`)
    }
    return 0
  }

  if (options.revert !== undefined) {
    const entry = revertChange({ ledgerDir: options.ledger, roots: SKILL_ROOTS, changeId: options.revert })
    console.log(`reverted ${options.revert} as ${entry.id}`)
    return 0
  }

  if (options.judge === undefined) {
    console.log('nothing to do: pass --status, --probe, --candidates, --judge <id>, or --revert <id>')
    return 2
  }

  const applied = inForce(options.ledger).find(entry => entry.id === options.judge)
  if (applied === undefined) {
    console.error(`no change in force with id ${options.judge}`)
    const known = readLedger(options.ledger).filter(entry => entry.outcome === 'applied').map(entry => entry.id)
    if (known.length > 0) console.error(`known: ${known.join(', ')}`)
    return 2
  }

  const decision = options.dryRun
    ? dryJudge(applied, options.home)
    : iterate({
      ledgerDir: options.ledger,
      roots: SKILL_ROOTS,
      changeId: options.judge,
      probe,
      window: { home: options.home },
      log: message => console.log(`  ${message}`),
    })
  report(decision)
  if (options.dryRun) console.log('  (dry run: no ledger entry was written, no file was reverted)')
  return decision.decision === 'inconclusive' ? 2 : 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
