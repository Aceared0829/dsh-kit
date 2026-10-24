/**
 * Rank observed signals by how often they COULD show up.
 *
 * The first experiment in this project picked a target (GUI repeat capture) that
 * turned out to occur in 7 of 76 sessions, so it could never accumulate samples.
 * That was not a measurement failure — it was a selection failure, and it cost
 * a full cycle.
 *
 * This module exists so the next target is chosen from data rather than
 * intuition. It counts, per signal, how many sessions could produce it, which is
 * exactly the `exposure` the verdict rule needs. A signal with low coverage
 * cannot be judged no matter how interesting it looks.
 *
 * Read-only: it reads session logs and returns numbers.
 *
 * @module dsh-harness-eval/candidates
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import { findSessionLogs, readSessionLog } from './reader.js'

/** Signals worth ranking, and what each means for a candidate experiment. */
const SIGNALS = [
  {
    key: 'uncoded',
    label: 'uncoded tool errors',
    note: 'A failure with no code: the biggest observation blind spot. Needs classification before it can be fixed.',
  },
  {
    key: 'fsNotObserved',
    label: 'FS_NOT_OBSERVED',
    note: 'Wrote or edited without reading first. The fix is tool guidance, which every call pays for.',
  },
  {
    key: 'webBlocked',
    label: 'WEB_BLOCKED_URL',
    note: 'Environment restriction, usually not fixable from inside the harness.',
  },
  {
    key: 'staleVersion',
    label: 'FS_STALE_VERSION',
    note: 'Concurrent or stale state. Deterministic; a retry usually succeeds.',
  },
  {
    key: 'toolOutcomeUnknown',
    label: 'TOOL_OUTCOME_UNKNOWN',
    note: 'The call lost contact. Often a timeout rather than an agent mistake.',
  },
  {
    key: 'unknownTool',
    label: 'UNKNOWN_TOOL',
    note: 'A mistake: the model invented a tool name.',
  },
  {
    key: 'invalidArgs',
    label: 'INVALID_ARGS',
    note: 'Schema violation. The tool definition may be under-specified.',
  },
  {
    key: 'codeRunFailed',
    label: 'CODE_RUN_FAILED',
    note: 'The body failed, not the dispatch. Needs the actual output to classify.',
  },
]

/**
 * Map a raw error code to a ranking key.
 * @param code - the code from the tool result.
 * @returns the signal key.
 */
function keyOf(code) {
  const table = {
    FS_NOT_OBSERVED: 'fsNotObserved',
    WEB_BLOCKED_URL: 'webBlocked',
    FS_STALE_VERSION: 'staleVersion',
    TOOL_OUTCOME_UNKNOWN: 'toolOutcomeUnknown',
    UNKNOWN_TOOL: 'unknownTool',
    INVALID_ARGS: 'invalidArgs',
    CODE_RUN_FAILED: 'codeRunFailed',
  }
  return table[code] ?? null
}

/**
 * Whether this tool result is one this plugin's own guard issued.
 *
 * Counted apart from real failures: a denial this plugin caused is not a
 * candidate for the agent to fix.
 * @param message - the tool result message.
 * @returns true when the guard refused the call.
 */
function isOwnGuardDenial(message) {
  const content = message?.content
  if (!Array.isArray(content)) return false
  return content.some(part => typeof part?.text === 'string'
    && part.text.includes('with exactly these arguments, and nothing acted on the window since'))
}

/**
 * Count signal coverage across every session under a home.
 * @param options - `{ home }`.
 * @returns sessions read plus per-signal coverage, ranked by session count.
 */
export function rankCandidates(options = {}) {
  const home = options.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const counts = new Map(SIGNALS.map(signal => [signal.key, { sessions: new Set(), occurrences: 0 }]))
  let sessions = 0
  for (const found of findSessionLogs(home)) {
    let events
    try {
      events = readSessionLog(found.path)
    } catch {
      continue
    }
    if (events[0]?.type !== 'session') continue
    // A session with no turn never ran anything, so it cannot be exposure for
    // any signal. Counting it would inflate every coverage figure.
    if (!events.some(event => event.type === 'turn/start')) continue
    sessions += 1
    for (const event of events) {
      if (event.type !== 'tool/result') continue
      const message = event.data?.message
      if (message?.isError !== true) continue
      if (isOwnGuardDenial(message)) continue
      const code = event.data?.error?.code
      const entry = counts.get(keyOf(typeof code === 'string' ? code : ''))
        ?? counts.get(code === undefined || code === null ? 'uncoded' : '')
      if (entry === undefined) continue
      entry.sessions.add(found.sessionId)
      entry.occurrences += 1
    }
  }
  const rows = SIGNALS.map(signal => {
    const entry = counts.get(signal.key)
    return {
      signal: signal.label,
      key: signal.key,
      sessions: entry.sessions.size,
      occurrences: entry.occurrences,
      // Coverage is what decides whether a verdict is even possible.
      coverage: sessions === 0 ? 0 : Math.round((entry.sessions.size / sessions) * 100),
      note: signal.note,
    }
  }).sort((left, right) => right.sessions - left.sessions || right.occurrences - left.occurrences)
  return { home, sessions, rows }
}
