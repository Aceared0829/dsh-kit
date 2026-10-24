/**
 * Export recorded harness evidence as one JSON object per session.
 *
 * Rows are REFOLDED from the session logs, not read out of the projection
 * cache. The cache is a performance artifact whose rows expire whenever
 * `stateVersion` changes, and it only exists for sessions that were live in
 * this process; the logs are the durable record. Refolding also means this
 * script and the live projection run the SAME fold (`lib/evidence.js`), so the
 * two cannot drift apart.
 *
 *   node export.mjs
 *   node export.mjs --out harness-evidence.jsonl
 *   node export.mjs --home <DSH_HOME> --include-empty
 *   node export.mjs --from-cache        # the old path, kept for A/B checks
 *
 * A log is exported only when its directory still exists and its header is the
 * current Session format. A deleted Session cannot leak in through a stale
 * cache document, because no log is read for it.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findSessionLogs, readSessionLog } from './lib/reader.js'
import { emptyState } from './lib/evidence.js'

/** Session format generation whose header this exporter accepts. */
const SESSION_FORMAT_VERSION = 4
/** Marks domain table that owns durable observations. */
const MARKS_UNIT = 'harness_marks'
/**
 * Default DSH home to read, when `DSH_HOME` is unset.
 *
 * Portable on purpose: the plugin ships without any machine-specific path, and
 * `DSH_HOME` is the same variable the Host itself resolves.
 */
const DEFAULT_HOME = join(homedir(), '.dsh')

/**
 * Parse the small command line this exporter accepts.
 * @param argv - arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv) {
  const options = {
    home: process.env.DSH_HOME ?? DEFAULT_HOME,
    out: undefined,
    includeEmpty: false,
    fromCache: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--include-empty') {
      options.includeEmpty = true
    } else if (arg === '--from-cache') {
      options.fromCache = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--home' || arg === '--out') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${arg} needs a value`)
      if (arg === '--home') options.home = value
      else options.out = value
      index += 1
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return options
}

/**
 * Read JSON, returning `undefined` instead of propagating a parse failure.
 * @param path - file to read.
 * @returns the parsed value, or undefined.
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read and validate the marks table.
 *
 * Storage-domain JSON files hold `{ unit, tables: { marks: { [id]: record } } }`.
 * A missing file means no mark has been written. Unknown or malformed records
 * are refused rather than silently dropped, because a verdict on incomplete
 * evidence is worse than a loud export failure.
 * @param path - the marks domain file.
 * @param schema - the mark schema exported by the plugin.
 * @returns marks keyed by session id, in creation order.
 */
function readMarks(path, schema) {
  if (!existsSync(path)) return new Map()
  const document = readJson(path)
  if (document === undefined) throw new Error(`cannot parse marks storage at ${path}`)
  if (document?.unit?.name !== MARKS_UNIT) {
    throw new Error(`marks storage at ${path} does not declare the ${MARKS_UNIT} unit`)
  }
  const records = document?.tables?.marks
  if (records === null || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`marks storage at ${path} has no marks table`)
  }
  const marks = new Map()
  for (const [id, raw] of Object.entries(records)) {
    let mark
    try {
      mark = schema.parse(raw)
    } catch (error) {
      throw new Error(`stored mark ${id} is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    const list = marks.get(mark.sessionId) ?? []
    list.push(mark)
    marks.set(mark.sessionId, list)
  }
  for (const list of marks.values()) list.sort((left, right) => left.createdAt - right.createdAt)
  return marks
}

/**
 * Load the projection definition without mounting Cordis.
 *
 * `apply` both registers the projection and mounts the marks service. A stub
 * Context captures only the definition; the exporter reads durable marks
 * itself, so the live service is neither needed nor reachable here.
 * @param plugin - the host plugin module.
 * @returns the registered projection definition.
 */
function projectionDefinition(plugin) {
  let definition
  plugin.apply({
    sessionProjections: {
      register: value => {
        definition = value
        return () => {}
      },
    },
    plugin: () => {},
    get: () => undefined,
    effect: () => () => {},
  })
  if (definition === undefined) throw new Error('the plugin did not register a projection definition')
  return definition
}

/**
 * Refold one session log into the state the projection would hold.
 *
 * Duplicate edges are skipped: a log can repeat a committed event when a
 * process restarts mid-turn, and folding it twice would double-count tokens and
 * tool calls. The projection never sees an event twice, so neither may this.
 * @param events - decoded events, header first.
 * @param definition - registered projection definition.
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
 * Build an export row from one folded state.
 * @param id - Session id.
 * @param state - folded projection state.
 * @param definition - registered projection definition.
 * @param marks - marks belonging to this Session.
 * @returns the export row.
 */
function exportRow(id, state, definition, marks) {
  const view = definition.wire.viewSchema.parse(definition.wire.view(state))
  return {
    session: id,
    turns: view.totals.turns,
    steps: view.totals.steps,
    toolCalls: view.totals.toolCalls,
    toolErrors: view.totals.toolErrors,
    // Cost. `inputTokens`/`outputTokens`/`cacheReadTokens` are summed;
    // `totalTokens` is a running total in real logs and is never summed.
    inputTokens: view.totals.inputTokens,
    outputTokens: view.totals.outputTokens,
    cacheReadTokens: view.totals.cacheReadTokens,
    messages: view.totals.messages,
    firstIncompleteTurn: view.firstIncompleteTurn ?? null,
    // The fork point counts only a real breakdown; a turn the person
    // interrupted is reported separately and never as a fork point.
    bifurcate: view.bifurcate,
    idleTurns: view.idleTurns,
    repeats: view.repeats,
    // Two separate classes: infrastructure retries are not agent mistakes.
    retries: view.retries,
    retryCodes: view.retryCodes,
    errorCodes: view.errorCodes,
    harness: view.harness,
    signature: view.signature ?? null,
    marks: marks.map(mark => ({
      turn: mark.turn,
      kind: mark.kind,
      reason: mark.reason,
    })),
  }
}

/**
 * Collect export rows from session logs.
 * @param options - resolved CLI options.
 * @param definition - registered projection definition.
 * @param marksBySession - durable marks keyed by Session id.
 * @returns export rows and summary counters.
 */
function collectFromLogs(options, definition, marksBySession) {
  const summary = { files: 0, exported: 0, empty: 0, oldFormat: 0, unreadable: 0 }
  const rows = []
  for (const found of findSessionLogs(options.home)) {
    summary.files += 1
    let events
    try {
      events = readSessionLog(found.path)
    } catch {
      summary.unreadable += 1
      continue
    }
    const header = events[0]
    if (header?.type !== 'session') {
      summary.unreadable += 1
      continue
    }
    if (header.version !== SESSION_FORMAT_VERSION) {
      summary.oldFormat += 1
      continue
    }
    const state = refold(events, definition)
    if (state.turns.length === 0 && !options.includeEmpty) {
      summary.empty += 1
      continue
    }
    rows.push(exportRow(String(header.id ?? found.sessionId), state, definition, marksBySession.get(String(header.id)) ?? []))
    summary.exported += 1
  }
  return { rows, summary }
}

/**
 * Collect export rows from the projection cache (the pre-version-5 path).
 *
 * Kept for A/B checking: after the port, this must agree with
 * `collectFromLogs` for every Session the cache still holds.
 * @param options - resolved CLI options.
 * @param definition - registered projection definition.
 * @param marksBySession - durable marks keyed by Session id.
 * @returns export rows and summary counters.
 */
function collectFromCache(options, definition, marksBySession) {
  const cacheDirectory = join(options.home, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(cacheDirectory)) throw new Error(`projection cache directory does not exist: ${cacheDirectory}`)
  const live = new Set()
  const liveRoot = join(options.home, 'sessions')
  if (existsSync(liveRoot)) {
    for (const workspace of readdirSync(liveRoot, { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue
      const workspacePath = join(liveRoot, workspace.name)
      for (const session of readdirSync(workspacePath, { withFileTypes: true })) {
        if (session.isDirectory()) live.add(session.name)
      }
    }
  }
  const summary = { files: 0, exported: 0, empty: 0, oldFormat: 0, oldEvidence: 0, missingEvidence: 0, orphaned: 0, malformed: 0 }
  const rows = []
  for (const name of readdirSync(cacheDirectory).filter(name => name.endsWith('.json')).sort()) {
    summary.files += 1
    const document = readJson(join(cacheDirectory, name))
    if (document === undefined) {
      summary.malformed += 1
      continue
    }
    const id = name.slice(0, -'.json'.length)
    if (!live.has(id)) {
      summary.orphaned += 1
      continue
    }
    if (document?.record?.identity?.formatVersion !== SESSION_FORMAT_VERSION) {
      summary.oldFormat += 1
      continue
    }
    const row = document?.record?.rows?.harnessEvidence
    if (row === undefined) {
      summary.missingEvidence += 1
      continue
    }
    if (row.ver !== definition.stateVersion) {
      summary.oldEvidence += 1
      continue
    }
    let state
    try {
      state = definition.stateSchema.parse(row.val)
    } catch {
      summary.malformed += 1
      continue
    }
    if (state.turns.length === 0 && !options.includeEmpty) {
      summary.empty += 1
      continue
    }
    rows.push(exportRow(id, state, definition, marksBySession.get(id) ?? []))
    summary.exported += 1
  }
  return { rows, summary }
}

/** Print usage. */
function usage() {
  console.log(`Usage: node export.mjs [--home <dir>] [--out <file>] [--include-empty] [--from-cache]

Refolds every session log into harness evidence and writes one JSON object per
Session. Without --out the rows go to stdout; the summary always goes to stderr.
Sessions with no turns are skipped unless --include-empty is given.

--from-cache reads the projection cache instead of the logs. It exists only to
cross-check the two paths, and skips any row written by an older evidence
version.`)
}

/**
 * Run the exporter.
 * @param argv - arguments after the script path.
 * @returns the process exit code.
 */
async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    usage()
    return 0
  }
  const plugin = await import(new URL('./lib/index.js', import.meta.url))
  const marks = await import(new URL('./lib/marks.js', import.meta.url))
  const definition = projectionDefinition(plugin)
  const marksBySession = readMarks(join(options.home, 'storages', 'harness_marks.json'), marks.markSchema)
  const { rows, summary } = options.fromCache
    ? collectFromCache(options, definition, marksBySession)
    : collectFromLogs(options, definition, marksBySession)
  const counts = Object.entries(summary)
    .filter(([key]) => key !== 'files' && key !== 'exported')
    .map(([key, value]) => `${value} ${key}`)
    .join(', ')
  if (rows.length === 0) {
    console.error(`no exportable Session evidence found under ${resolve(options.home)}; ${counts}`)
    return 2
  }
  const text = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
  if (options.out === undefined) process.stdout.write(text)
  else writeFileSync(resolve(options.out), text, 'utf8')
  const destination = options.out === undefined ? 'stdout' : resolve(options.out)
  console.error(`exported ${summary.exported} session(s) of ${summary.files} scanned to ${destination}; ${counts}`)
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

export { main, refold, collectFromLogs, collectFromCache, readMarks, projectionDefinition }
