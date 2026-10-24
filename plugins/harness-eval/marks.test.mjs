/**
 * Tests for the mark record contract.
 *
 * A mark is a person's durable observation about one turn, carrying the harness
 * fingerprint it was made under. These assert the schema's boundaries and the
 * lossless-JSON rule the storage domain also enforces, because a stored record
 * is validated at the durable read boundary on every open.
 *
 *   node --test plugins/harness-eval/marks.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { markSchema, marksDomain, MARK_KINDS, MAX_REASON_LENGTH } = await import('./lib/marks.js')

/** Collect `undefined`-valued paths; JSON drops these silently. */
function undefinedPaths(value, path = '$', out = []) {
  if (value === undefined) {
    out.push(path)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  for (const key of Object.keys(value)) undefinedPaths(value[key], `${path}.${key}`, out)
  return out
}

/** A valid mark, overridable per test. */
const validMark = (overrides = {}) => ({
  id: 'mark-1',
  sessionId: 'session-1',
  turn: 3,
  kind: 'failure',
  reason: 'stalled rereading the same file',
  createdAt: 1792376749018,
  harness: { cwd: 'D:/workspace', agentPreset: 'cordis' },
  ...overrides,
})

test('the domain declares a lower-case name and a positive version', () => {
  // The name doubles as the backend unit name and must survive
  // `defineDomain`'s UNIT_NAME_RE check.
  assert.equal(marksDomain.name, 'harness_marks')
  assert.ok(Number.isInteger(marksDomain.version) && marksDomain.version > 0)
  assert.deepEqual(Object.keys(marksDomain.tables), ['marks'])
})

test('a valid mark parses and round-trips as lossless JSON', () => {
  const parsed = markSchema.parse(validMark())
  assert.deepEqual(undefinedPaths(parsed), [])
  const json = JSON.stringify(parsed)
  assert.equal(JSON.stringify(JSON.parse(json)), json)
})

test('every declared kind is accepted', () => {
  for (const kind of MARK_KINDS) {
    assert.equal(markSchema.parse(validMark({ kind })).kind, kind)
  }
})

test('an unknown kind is rejected', () => {
  assert.throws(() => markSchema.parse(validMark({ kind: 'maybe' })))
})

test('an empty reason is rejected', () => {
  // A mark without a reason is not a useful observation; the schema refuses it
  // rather than storing an empty string that the export would carry.
  assert.throws(() => markSchema.parse(validMark({ reason: '' })))
})

test('an over-long reason is rejected at the declared bound', () => {
  assert.doesNotThrow(() => markSchema.parse(validMark({ reason: 'x'.repeat(MAX_REASON_LENGTH) })))
  assert.throws(() => markSchema.parse(validMark({ reason: 'x'.repeat(MAX_REASON_LENGTH + 1) })))
})

test('a negative or fractional turn is rejected', () => {
  assert.throws(() => markSchema.parse(validMark({ turn: -1 })))
  assert.throws(() => markSchema.parse(validMark({ turn: 1.5 })))
})

test('absent harness facts are omitted, not written as undefined', () => {
  const parsed = markSchema.parse(validMark({ harness: {} }))
  assert.equal('cwd' in parsed.harness, false, 'an absent cwd must not appear as a key')
  assert.equal('agentPreset' in parsed.harness, false)
  assert.equal('parentSession' in parsed.harness, false)
  assert.deepEqual(undefinedPaths(parsed), [])
})

test('an explicit undefined harness field is normalized away, not stored', () => {
  // zod treats `optional()` as accepting an explicit `undefined`, so parsing is
  // the normalization step: the key is dropped, and the stored record holds no
  // `undefined` for the durable boundary to reject.
  const parsed = markSchema.parse(validMark({ harness: { cwd: undefined } }))
  assert.equal('cwd' in parsed.harness, false)
  assert.deepEqual(undefinedPaths(parsed), [])
})

test('unknown top-level fields are rejected', () => {
  // A strict record keeps the stored contract honest: a field the schema does
  // not declare cannot enter the export unnoticed.
  assert.throws(() => markSchema.parse(validMark({ extra: true })))
})
