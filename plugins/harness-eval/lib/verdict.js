/**
 * S4 — decide whether a change actually helped.
 *
 * S3 can apply a change and measure before and after. The missing piece is the
 * VERDICT: a rule that turns two numbers into keep, revert, or not-enough-data.
 * Without it, every reading is a judgement call, and a judgement call is
 * exactly what an RSI loop must not depend on.
 *
 * The rules encoded here are deliberately conservative, in the direction that
 * refuses to credit a change:
 *
 * - **Too few samples is not a result.** One session differs from the next by
 *   tens of percent on the same task, so a single reading cannot distinguish a
 *   real effect from noise. Below the minimum the answer is `inconclusive`.
 * - **A rise in cost vetoes the change**, even when the metric improved. A
 *   guidance that fixes repeats by making every call more expensive is a worse
 *   deal that only looks like progress.
 * - **The guard's own denials are not the metric.** They are excluded before
 *   the comparison, because a working guard would otherwise raise the repeat
 *   rate it is trying to lower.
 *
 * @module dsh-harness-eval/verdict
 */

/** Sessions required on each side before an effect can be claimed. */
export const MIN_SAMPLES = 3

/**
 * How much a change must move the metric to count.
 *
 * Relative, not absolute: 5 repeats down to 3 is one thing on a baseline of 9
 * calls and another on a baseline of 500. Expressed as a fraction of the
 * baseline so the same threshold holds across sessions of any size.
 */
export const MEANINGFUL_RELATIVE_DROP = 0.2

/** How much cost may rise before the change is refused regardless of the metric. */
export const COST_TOLERANCE = 0.05

/**
 * @typedef {object} Side
 * @property {number} sessions - sessions measured.
 * @property {number} metric - the figure the change claims to move.
 * @property {number} cost - the guard figure, usually input tokens.
 */

/**
 * Compare two sides and return a verdict.
 *
 * @param options - before/after figures plus the direction the metric should move.
 * @returns the verdict and the reasoning behind it.
 */
export function judge(options) {
  const { before, after, direction = 'lower' } = options
  const notes = []
  if (before.sessions < MIN_SAMPLES || after.sessions < MIN_SAMPLES) {
    return {
      verdict: 'inconclusive',
      reason: 'not-enough-samples',
      detail: `before has ${before.sessions} session(s) and after has ${after.sessions}; `
        + `at least ${MIN_SAMPLES} on each side is required, because one session differs from another by tens of percent on the same task.`,
      notes,
    }
  }
  // Compare rates, not totals: the two sides usually cover different numbers of
  // sessions, so a total would reward the side that simply ran more.
  const beforeRate = rate(before.metric, before.sessions)
  const afterRate = rate(after.metric, after.sessions)
  if (beforeRate === 0) {
    return {
      verdict: 'inconclusive',
      reason: 'zero-baseline',
      detail: 'the metric was already zero before the change, so there is nothing to improve.',
      notes,
    }
  }
  // A metric that vanished because the OPPORTUNITY vanished is not an
  // improvement. Observed on real data: repeats fell 173 -> 0 because not one
  // session after the change used a GUI tool at all. That is a different claim
  // from "the rule stopped the repeats", and crediting it keeps a change that
  // was never exercised.
  //
  // `exposure` is the count of sessions where the metric COULD occur. Callers
  // that cannot supply it keep the old behaviour rather than being blocked by a
  // check they cannot satisfy.
  if (after.exposure !== undefined && after.exposure === 0) {
    return {
      verdict: 'inconclusive',
      reason: 'no-exposure',
      detail: `the metric fell to zero, but not one of the ${after.sessions} session(s) after the change could `
        + 'have produced it, so the change was never exercised. This is not evidence of an improvement.',
      metric: { beforeRate, afterRate, relative: -1 },
      notes,
    }
  }
  const relative = (afterRate - beforeRate) / beforeRate
  const improved = direction === 'lower' ? relative <= -MEANINGFUL_RELATIVE_DROP : relative >= MEANINGFUL_RELATIVE_DROP
  const costChange = costRatio(before, after)
  if (costChange !== null && costChange > COST_TOLERANCE) {
    notes.push(`cost rose ${(costChange * 100).toFixed(1)}% (tolerance ${(COST_TOLERANCE * 100).toFixed(0)}%)`)
    return {
      verdict: 'reverted',
      reason: 'cost-rose',
      detail: `the metric moved ${(relative * 100).toFixed(1)}% but cost rose ${(costChange * 100).toFixed(1)}%; `
        + 'paying more per call to make fewer calls is a worse deal that only looks like progress.',
      metric: { beforeRate, afterRate, relative },
      notes,
    }
  }
  if (!improved) {
    // The wording has to match the direction, or a worsening reads as "close but
    // not enough", which is the opposite of what happened.
    return {
      verdict: relative > 0 ? 'reverted' : 'inconclusive',
      reason: relative > 0 ? 'metric-worsened' : 'within-noise',
      detail: relative > 0
        ? `the metric worsened by ${(relative * 100).toFixed(1)}%.`
        : `the metric moved ${(relative * 100).toFixed(1)}%, below the ${(MEANINGFUL_RELATIVE_DROP * 100).toFixed(0)}% needed to claim an effect.`,
      metric: { beforeRate, afterRate, relative },
      notes,
    }
  }
  return {
    verdict: 'kept',
    reason: 'metric-improved',
    detail: `the metric moved ${(relative * 100).toFixed(1)}% with cost ${costChange === null ? 'not measured' : `${(costChange * 100).toFixed(1)}%`}.`,
    metric: { beforeRate, afterRate, relative },
    notes,
  }
}

/**
 * Per-session rate.
 * @param total - the aggregate figure.
 * @param sessions - how many sessions it came from.
 * @returns the figure per session.
 */
function rate(total, sessions) {
  return sessions === 0 ? 0 : total / sessions
}

/**
 * Relative change in cost.
 * @param before - the baseline side.
 * @param after - the changed side.
 * @returns the ratio, or null when either side records no cost.
 */
function costRatio(before, after) {
  const base = rate(before.cost, before.sessions)
  const next = rate(after.cost, after.sessions)
  if (!(base > 0)) return null
  return (next - base) / base
}
