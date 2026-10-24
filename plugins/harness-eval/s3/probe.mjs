/**
 * S3 probe: measure the one metric candidate 1 claims to move.
 *
 * The measurement is defined here, once, and used for both sides of the
 * comparison. A probe that re-derives its metric per run cannot tell an
 * improvement from a redefinition.
 *
 *   node s3/probe.mjs --since <ISO date>       # sessions after a change
 *   node s3/probe.mjs --until <ISO date>       # sessions before it
 *   node s3/probe.mjs                          # everything
 *
 * The figures come from the frozen evidence fold (`lib/evidence.js`), so the
 * probe agrees with what the Harness tab shows.
 */

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { findSessionLogs, readSessionLog } from '../lib/reader.js'
import { emptyState, fold } from '../lib/evidence.js'

/**
 * Default DSH home to read, when `DSH_HOME` is unset.
 *
 * Portable on purpose: the plugin ships without any machine-specific path, and
 * `DSH_HOME` is the same variable the Host itself resolves.
 */
const DEFAULT_HOME = join(homedir(), '.dsh')

/** Tools the candidate is about. A repeat outside this prefix is not its target. */
const GUI_PREFIX = 'cua_driver_native__'

/**
 * Parse the command line.
 * @param argv - arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv) {
  const options = { home: process.env.DSH_HOME ?? DEFAULT_HOME, since: undefined, until: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--since' || arg === '--until' || arg === '--home') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      if (arg === '--home') options.home = value
      else if (arg === '--since') options.since = Date.parse(value)
      else options.until = Date.parse(value)
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node s3/probe.mjs [--since <date>] [--until <date>] [--home <dir>] [--json]')
      process.exit(0)
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return options
}

/**
 * Whether this tool result is the repeat guard refusing a call.
 *
 * A denied call still appears in the log as a `tool/call` followed by an error
 * result. Counting it as a repeated observation would make the guard look like
 * the problem it fixes: every denial would RAISE the repeat rate, so a working
 * guard would be reverted as a regression. The denial is counted separately and
 * is what "the guard caught this one" means.
 * @param event - a `tool/result` event.
 * @returns true when the result came from the repeat guard.
 */
function isGuardDenial(event) {
  const message = event.data?.message
  if (message?.isError !== true) return false
  const content = message.content
  if (!Array.isArray(content)) return false
  return content.some(part => typeof part?.text === 'string'
    && part.text.includes('with exactly these arguments, and nothing acted on the window since'))
}

/**
 * Fold one session and compute its GUI repeat figures.
 * @param events - decoded events, header first.
 * @returns the per-session figures, or null when the session is outside scope.
 */
function measure(events) {
  const header = events[0]
  if (header?.type !== 'session') return null
  let state = emptyState()
  const seen = new Set()
  // Repeats are counted per tool, because the candidate only claims the GUI
  // tools; a repeat in `read` is a different behaviour with a different fix.
  const guiCounts = new Map()
  // Call ids the guard refused, so their `tool/call` is excluded from the
  // repeat count instead of being blamed on the model.
  const deniedCallIds = new Set()
  for (const event of events) {
    if (event === header) continue
    if (typeof event.seq === 'number') {
      if (seen.has(event.seq)) continue
      seen.add(event.seq)
    }
    state = fold(state, event)
    if (event.type === 'tool/result' && isGuardDenial(event)) {
      const callId = event.data?.message?.toolCallId
      if (typeof callId === 'string') deniedCallIds.add(callId)
    }
    if (event.type === 'tool/call' && String(event.data?.name ?? '').startsWith(GUI_PREFIX)) {
      const key = `${event.data.name}\u0000${event.data.arguments ?? ''}`
      guiCounts.set(key, (guiCounts.get(key) ?? 0) + 1)
    }
  }
  let guiRepeats = 0
  let guiCalls = 0
  let worst = 0
  for (const count of guiCounts.values()) {
    guiCalls += count
    if (count > 1) guiRepeats += count - 1
    worst = Math.max(worst, count)
  }
  const guardDenials = deniedCallIds.size
  return {
    sessionId: String(header.id ?? ''),
    createdAt: Number(header.createdAt ?? 0),
    turns: state.turns.length,
    calls: state.totalToolCalls,
    inputTokens: state.usage.inputTokens,
    outputTokens: state.usage.outputTokens,
    guiCalls,
    guiRepeats,
    worstGuiCall: worst,
    // What the guard stopped. Reported separately so it is never read as a
    // repeat the model made.
    guardDenials,
    // The share of GUI calls that were a re-issue, which is the figure the
    // candidate predicts will fall. Reported so a session that simply used the
    // GUI less does not read as an improvement.
    guiRepeatShare: guiCalls === 0 ? null : Math.round((guiRepeats / guiCalls) * 100),
  }
}

/**
 * Aggregate a set of sessions.
 * @param rows - measured sessions.
 * @returns the summary figures.
 */
function summarize(rows) {
  const usable = rows.filter(row => row.turns > 0)
  const sum = key => usable.reduce((total, row) => total + row[key], 0)
  const guiCalls = sum('guiCalls')
  const guiRepeats = sum('guiRepeats')
  return {
    sessions: usable.length,
    sessionsWithGui: usable.filter(row => row.guiCalls > 0).length,
    guiCalls,
    guiRepeats,
    guardDenials: sum('guardDenials'),
    guiRepeatShare: guiCalls === 0 ? null : Math.round((guiRepeats / guiCalls) * 100),
    worstGuiCall: usable.reduce((peak, row) => Math.max(peak, row.worstGuiCall), 0),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    calls: sum('calls'),
  }
}

/**
 * Measure a window of sessions.
 *
 * Exported so the loop (`src/loop.js`) runs THIS measurement rather than a
 * second implementation of it. A loop that measures differently from the probe
 * would decide on figures nobody can reproduce.
 * @param options - `{ home, since?, until? }` as epoch milliseconds.
 * @returns `{ sessions, metric, cost, rows }` where `metric` is the GUI repeat
 *   count excluding calls the guard refused, and `cost` is input tokens.
 */
export function measureWindow(options = {}) {
  const home = options.home ?? process.env.DSH_HOME ?? DEFAULT_HOME
  const rows = []
  for (const found of findSessionLogs(home)) {
    let events
    try {
      events = readSessionLog(found.path)
    } catch {
      continue
    }
    const measured = measure(events)
    if (measured === null) continue
    if (options.since !== undefined && !(measured.createdAt >= options.since)) continue
    if (options.until !== undefined && !(measured.createdAt <= options.until)) continue
    rows.push(measured)
  }
  const summary = summarize(rows)
  return {
    sessions: summary.sessions,
    // How many sessions could have produced the metric at all. A GUI repeat
    // needs a GUI call; without this, a silent zero reads as a fix.
    exposure: summary.sessionsWithGui,
    // The figure the change claims to move: repeated GUI observations that the
    // model actually paid for.
    metric: summary.guiRepeats,
    cost: summary.inputTokens,
    guardDenials: summary.guardDenials,
    rows,
    summary,
  }
}

/**
 * Run the probe.
 * @param argv - arguments after the script path.
 * @returns the process exit code.
 */
async function main(argv) {
  const options = parseArgs(argv)
  const { rows, summary } = measureWindow({
    home: options.home,
    since: options.since,
    until: options.until,
  })
  const window = [
    options.since === undefined ? 'beginning' : new Date(options.since).toISOString(),
    options.until === undefined ? 'now' : new Date(options.until).toISOString(),
  ].join(' .. ')
  if (options.json) {
    console.log(JSON.stringify({ window, summary, rows }, null, 2))
    return 0
  }
  console.log(`window: ${window}`)
  console.log(`sessions with turns: ${summary.sessions} (${summary.sessionsWithGui} used GUI tools)`)
  console.log(`GUI calls: ${summary.guiCalls}`)
  console.log(`GUI repeats: ${summary.guiRepeats} (${summary.guiRepeatShare ?? 'n/a'}% of GUI calls)`)
  // Kept on its own line: these are calls the guard stopped BEFORE dispatch, so
  // they were never paid for. Reading them as repeats would invert the verdict.
  console.log(`guard denials: ${summary.guardDenials} (stopped before dispatch, not paid for)`)
  console.log(`worst single call: ${summary.worstGuiCall}x`)
  console.log(`tokens: in ${summary.inputTokens.toLocaleString()} / out ${summary.outputTokens.toLocaleString()}`)
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
