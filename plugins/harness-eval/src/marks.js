/**
 * The `harnessMarks` domain: human observations about a session's turns.
 *
 * A mark records what a person judged about one turn — that it failed for a
 * specific reason, or that it went well — together with the harness fingerprint
 * the run had at that moment. The fingerprint is copied in rather than
 * referenced, so a mark still answers "did the same failure recur under the
 * same harness?" after the session's own records are gone.
 *
 * Marks are deliberately NOT session events: they are a person's observation,
 * not a model input, so they stay outside the log, its format version, and the
 * model-visible ⟺ logged rule.
 *
 * @module dsh-harness-eval/marks
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** The judgement a person attaches to one turn. */
export const MARK_KINDS = ['failure', 'success', 'note']

/** Longest accepted reason, in characters. */
export const MAX_REASON_LENGTH = 500

/**
 * The harness fingerprint at marking time, so marks stay comparable after the
 * session is gone.
 *
 * A `.transform` drops keys whose value is `undefined`: zod accepts an explicit
 * `undefined` for an optional key and keeps the key present, and JSON then
 * silently drops it — the stored record would look right while carrying a key
 * the durable boundary cannot compare. Dropping here makes "absent" mean one
 * thing.
 */
const harnessFingerprint = z.object({
  cwd: z.string().optional(),
  agentPreset: z.string().optional(),
  parentSession: z.string().optional(),
}).strict().transform(value => {
  const kept = {}
  for (const key of ['cwd', 'agentPreset', 'parentSession']) {
    if (value[key] !== undefined) kept[key] = value[key]
  }
  return kept
})

/** One durable mark. */
export const markSchema = z.object({
  /** Stable mark id, so a later edit or delete names one record. */
  id: z.string().min(1),
  /** Session the turn belongs to. */
  sessionId: z.string().min(1),
  /** 1-based turn number, matching the evidence projection's `turn`. */
  turn: z.number().int().nonnegative(),
  /** What the person judged. */
  kind: z.enum(MARK_KINDS),
  /** Why, in the person's words. Always present; an empty reason is not a mark. */
  reason: z.string().min(1).max(MAX_REASON_LENGTH),
  /** Unix epoch milliseconds when the mark was recorded. */
  createdAt: z.number(),
  /** The harness fingerprint at marking time. */
  harness: harnessFingerprint,
}).strict()

/** The declared domain; `defineDomain` validates the name and version at load. */
export const marksDomain = defineDomain({
  // `UNIT_NAME_RE` requires lowercase with underscores; the name doubles as the
  // backend unit name, so it stays stable once data exists.
  name: 'harness_marks',
  version: 1,
  tables: { marks: domainTable(markSchema) },
})
