/**
 * Tests for the S4 verdict rule.
 *
 * The verdict is what turns two measurements into keep/revert/inconclusive, so
 * a wrong rule is worse than no rule: it credits changes that did nothing and
 * rolls back changes that worked. Each test pins one of those failure modes.
 *
 *   node --test plugins/harness-eval/verdict.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { judge, MIN_SAMPLES, COST_TOLERANCE, MEANINGFUL_RELATIVE_DROP } from './lib/verdict.js'

/** A baseline side. */
const before = (overrides = {}) => ({ sessions: 10, metric: 40, cost: 1_000_000, ...overrides })

test('a clear drop with flat cost is kept', () => {
  const result = judge({ before: before(), after: before({ metric: 20 }) })
  assert.equal(result.verdict, 'kept')
  assert.equal(result.reason, 'metric-improved')
})

test('a rise in cost vetoes a real improvement', () => {
  // The metric halved, but every call now costs 30% more. Paying more per call
  // to make fewer calls is a worse deal, and must not read as progress.
  const result = judge({ before: before(), after: before({ metric: 20, cost: 1_300_000 }) })
  assert.equal(result.verdict, 'reverted')
  assert.equal(result.reason, 'cost-rose')
})

test('cost within tolerance does not veto', () => {
  const result = judge({ before: before(), after: before({ metric: 20, cost: 1_000_000 * (1 + COST_TOLERANCE / 2) }) })
  assert.equal(result.verdict, 'kept')
})

test('too few samples on either side is inconclusive, not a result', () => {
  const small = before({ sessions: MIN_SAMPLES - 1 })
  assert.equal(judge({ before: small, after: before({ metric: 20 }) }).reason, 'not-enough-samples')
  assert.equal(judge({ before: before(), after: small }).reason, 'not-enough-samples')
})

test('exactly the minimum sample count is enough', () => {
  const sample = before({ sessions: MIN_SAMPLES, metric: 40 })
  const afterSample = before({ sessions: MIN_SAMPLES, metric: 20 })
  assert.equal(judge({ before: sample, after: afterSample }).verdict, 'kept')
})

test('a change smaller than the threshold is within noise', () => {
  // Just inside the guard band, so it must not be credited.
  const after = before({ metric: 40 * (1 - MEANINGFUL_RELATIVE_DROP / 2) })
  const result = judge({ before: before(), after })
  assert.equal(result.verdict, 'inconclusive')
  assert.equal(result.reason, 'within-noise')
})

test('a worsening is reverted and says so', () => {
  const result = judge({ before: before(), after: before({ metric: 60 }) })
  assert.equal(result.verdict, 'reverted')
  assert.equal(result.reason, 'metric-worsened')
  // The wording must not describe a worsening as "below the threshold".
  assert.match(result.detail, /worsened/)
})

test('a zero baseline has nothing to improve', () => {
  const result = judge({ before: before({ metric: 0 }), after: before({ metric: 0 }) })
  assert.equal(result.verdict, 'inconclusive')
  assert.equal(result.reason, 'zero-baseline')
})

test('rates are compared per session, not in totals', () => {
  // The after side ran twice as many sessions. Totals would look worse
  // (40 vs 40 is flat) while the per-session rate halved.
  const result = judge({ before: before({ sessions: 10, metric: 40 }), after: before({ sessions: 20, metric: 40 }) })
  assert.equal(result.verdict, 'kept', 'the per-session rate fell even though the total did not')
})

test('an unmeasured cost cannot veto', () => {
  const result = judge({ before: before({ cost: 0 }), after: before({ metric: 20, cost: 5_000_000 }) })
  assert.equal(result.verdict, 'kept')
})

test('the direction can be flipped for a metric that should rise', () => {
  const result = judge({ before: before({ metric: 20 }), after: before({ metric: 40 }), direction: 'higher' })
  assert.equal(result.verdict, 'kept')
})

test('a metric that vanished because the opportunity vanished is not an improvement', () => {
  // Real case: repeats fell 173 -> 0 because not one session after the change
  // used a GUI tool. Crediting that would keep a change that was never run.
  const result = judge({
    before: before({ sessions: 71, metric: 173, exposure: 13 }),
    after: before({ sessions: 5, metric: 0, exposure: 0 }),
  })
  assert.equal(result.verdict, 'inconclusive')
  assert.equal(result.reason, 'no-exposure')
  assert.match(result.detail, /never exercised/)
})

test('a real drop with exposure is still credited', () => {
  const result = judge({
    before: before({ sessions: 10, metric: 40, exposure: 10 }),
    after: before({ sessions: 10, metric: 10, exposure: 8 }),
  })
  assert.equal(result.verdict, 'kept')
})

test('a caller that cannot report exposure is not blocked by the check', () => {
  // The guard must not silently disable itself for callers that predate it.
  const result = judge({ before: before({ metric: 40 }), after: before({ metric: 10 }) })
  assert.equal(result.verdict, 'kept')
})