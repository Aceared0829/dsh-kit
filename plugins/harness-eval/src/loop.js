/**
 * The closed loop: measure, judge, act.
 *
 * S1–S4 built four capabilities that each run on their own. This module is the
 * only place they become a LOOP, and the value is not that it automates
 * something — it is that the decision between the steps stops being a person's
 * judgement call.
 *
 * One iteration is:
 *
 *   1. **Measure** the baseline from the ledger's own context, or from the
 *      session logs, using the same probe the comparison will use later.
 *   2. **Judge** the reading with the verdict rule (`src/verdict.js`).
 *   3. **Act**: `kept` leaves the change in force, `reverted` calls
 *      `revertChange`, and `inconclusive` does nothing and says what is missing.
 *
 * Three properties make this safe to run unattended:
 *
 * - **It refuses to act on thin evidence.** `inconclusive` is a real outcome,
 *   not a step to push past; the loop reports what would make it decidable.
 * - **It never widens its own scope.** Reverts go through `revertChange`, which
 *   enforces the same root containment as the apply.
 * - **It records every decision.** A loop that keeps or reverts without a
 *   ledger entry is indistinguishable from one that did nothing.
 *
 * @module dsh-harness-eval/loop
 */

import { MIN_SAMPLES, judge } from './verdict.js'
import { inForce, readLedger, recordVerdict, revertChange } from './ledger.js'

/**
 * @typedef {object} IterationOptions
 * @property {string} ledgerDir - where the ledger lives.
 * @property {string[]} roots - directories a revert may write inside.
 * @property {string} changeId - the applied change this iteration judges.
 * @property {{measure: (options: object) => object}} probe - the measurement source.
 * @property {object} window - before/after bounds handed to the probe.
 * @property {(message: string) => void} [log] - progress sink.
 */

/**
 * Run one iteration: measure both sides, judge, and act.
 * @param options - see `IterationOptions`.
 * @returns the decision, with the measurements it was based on.
 */
export function iterate(options) {
  const { ledgerDir, roots, changeId, probe, window, log = () => {} } = options
  const applied = inForce(ledgerDir).find(entry => entry.id === changeId)
  if (applied === undefined) {
    return {
      decision: 'inconclusive',
      reason: 'no-such-change',
      detail: `change ${changeId} is not in force in ${ledgerDir}, so there is nothing to judge.`,
    }
  }

  // The split is the change's own timestamp, not a date a caller passes in:
  // reusing the recorded moment is what keeps two runs of the loop comparable.
  const boundary = Date.parse(applied.at)
  log(`measuring baseline before ${applied.at}`)
  const before = probe.measure({ ...window, until: boundary })
  log(`measuring effect after ${applied.at}`)
  const after = probe.measure({ ...window, since: boundary })

  const reading = judge({
    before: { sessions: before.sessions, metric: before.metric, cost: before.cost, exposure: before.exposure },
    after: { sessions: after.sessions, metric: after.metric, cost: after.cost, exposure: after.exposure },
  })
  log(`verdict ${reading.verdict} (${reading.reason})`)

  const decision = {
    changeId,
    decision: reading.verdict,
    reason: reading.reason,
    detail: reading.detail,
    measurement: {
      before: { sessions: before.sessions, metric: before.metric, cost: before.cost, exposure: before.exposure },
      after: { sessions: after.sessions, metric: after.metric, cost: after.cost, exposure: after.exposure },
      boundary: new Date(boundary).toISOString(),
    },
    // Sessions after the change that could have produced the metric at all.
    exposure: after.exposure,
    action: 'none',
  }

  // `inconclusive` is deliberately NOT a retry: acting on thin evidence is the
  // failure this whole loop exists to prevent.
  if (reading.verdict === 'inconclusive') {
    decision.action = 'none'
    decision.missing = missingFor(before, after)
    recordVerdict({
      ledgerDir,
      changeId,
      before: decision.measurement.before,
      after: decision.measurement.after,
      verdict: 'inconclusive',
      note: `${reading.reason}: ${reading.detail} ${decision.missing ?? ''}`.trim(),
    })
    return decision
  }

  if (reading.verdict === 'kept') {
    decision.action = 'kept'
    recordVerdict({
      ledgerDir,
      changeId,
      before: decision.measurement.before,
      after: decision.measurement.after,
      verdict: 'kept',
      note: reading.detail,
    })
    return decision
  }

  // reverted
  try {
    const revert = revertChange({ ledgerDir, roots, changeId })
    decision.action = 'reverted'
    decision.revertId = revert.id
    recordVerdict({
      ledgerDir,
      changeId,
      before: decision.measurement.before,
      after: decision.measurement.after,
      verdict: 'reverted',
      note: `${reading.detail} (auto-reverted as ${revert.id})`,
    })
  } catch (error) {
    // A failed revert must not be reported as a successful one. The change stays
    // in force and the failure is surfaced with its own reason.
    decision.action = 'revert-failed'
    decision.detail = `${decision.detail} BUT the revert failed: ${error instanceof Error ? error.message : String(error)}`
  }
  return decision
}

/**
 * Say what would make an inconclusive reading decidable.
 * @param before - the baseline side.
 * @param after - the changed side.
 * @returns a sentence naming the missing evidence, or undefined.
 */
function missingFor(before, after) {
  const short = []
  if (before.sessions < MIN_SAMPLES) short.push(`${MIN_SAMPLES - before.sessions} more baseline session(s)`)
  if (after.sessions < MIN_SAMPLES) short.push(`${MIN_SAMPLES - after.sessions} more session(s) after the change`)
  if (short.length === 0) return undefined
  // An empty "after" side usually means no session has run yet, not that the
  // measurement failed. Saying so prevents a reader from hunting a bug.
  const hint = after.sessions === 0
    ? ' No session has run since the change, so there is nothing to compare against yet.'
    : ''
  return `Needs ${short.join(' and ')} before this can be decided.${hint}`
}

/**
 * Summarize what the loop has decided so far.
 * @param ledgerDir - where the ledger lives.
 * @returns one row per applied change with its latest verdict.
 */
export function status(ledgerDir) {
  const entries = readLedger(ledgerDir)
  const verdictOf = new Map()
  for (const entry of entries) {
    if (entry.outcome === 'verdict') verdictOf.set(entry.verdictOf, entry)
  }
  const reverted = new Set(entries.filter(entry => entry.outcome === 'reverted').map(entry => entry.revertOf))
  return entries
    .filter(entry => entry.outcome === 'applied')
    .map(entry => {
      const verdict = verdictOf.get(entry.id)
      return {
        id: entry.id,
        target: entry.target,
        appliedAt: entry.at,
        inForce: !reverted.has(entry.id),
        verdict: verdict?.verdict ?? null,
        reason: verdict?.note ?? null,
        measurements: verdict?.measurement ?? null,
      }
    })
}
