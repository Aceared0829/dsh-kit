/**
 * Tests for the JSONL evidence exporter.
 *
 * Two paths exist and both are covered here:
 *
 *   - `refold from the session log` (the default): the durable record. Every
 *     Session that still has a log is exported, and rows are recomputed with
 *     the same fold the live projection uses.
 *   - `--from-cache`: the pre-version-5 path, kept to cross-check the two. It
 *     reads the projection cache and skips rows an older version wrote.
 *
 *   node --test plugins/harness-eval/export.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const exporter = join(here, 'export.mjs')

/** A session header as the store mints it. */
const header = id => ({ type: 'session', version: 4, id, createdAt: 10, cwd: 'D:/work', isSeeded: false, delegationDepth: 0, agentPreset: 'cordis' })

/** Encode events as a plaintext session log. */
const encodeLog = events => `${events.map(event => JSON.stringify(event)).join('\n')}\n`

/**
 * Build a temporary DSH home.
 * @param options - overrides for the generated fixture.
 * @returns the fixture roots and id.
 */
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'harness-export-'))
  const home = join(root, 'home')
  const sessions = join(home, 'sessions', '--workspace--')
  mkdirSync(sessions, { recursive: true })
  mkdirSync(join(home, 'storages'), { recursive: true })
  const id = options.id ?? 'session-test'
  const includeSession = options.includeSession ?? true
  if (includeSession) mkdirSync(join(sessions, id))
  // A log fixture: the durable record the default path reads.
  if (includeSession && options.events !== null) {
    writeFileSync(join(sessions, id, 'session.v4.jsonl'), encodeLog(options.events ?? [
      header(id),
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 2, data: { turn: 1, step: 0 } },
      { type: 'tool/call', seq: 3, data: { turn: 1, step: 0, callId: 'c1', name: 'read', arguments: '{"p":"a"}' } },
      { type: 'assistant/message', seq: 4, data: { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, totalTokens: 999 } } },
      { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ]))
  }
  // A cache fixture: what the --from-cache path reads.
  if (options.withCache ?? false) {
    const cache = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(cache, { recursive: true })
    const state = options.state ?? {
      sessionId: id,
      harness: { cwd: 'D:/work', agentPreset: 'cordis', createdAt: 10 },
      turns: [{ turn: 1, seq: 1, outcome: 'completed', steps: 2, toolCalls: 1, toolErrors: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, retries: 0 }],
      closedTurns: 1,
      totalSteps: 2,
      totalToolCalls: 1,
      totalToolErrors: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, messages: 0 },
      retries: { count: 0, codes: {} },
      errorCodes: {},
      repeats: 0,
      repeatCounts: {},
      harnessSignature: null,
    }
    writeFileSync(join(cache, `${id}.json`), `${JSON.stringify({
      record: {
        identity: { formatVersion: options.formatVersion ?? 4, createdAt: 10 },
        rows: { harnessEvidence: { ver: options.evidenceVersion ?? 5, seq: 2, val: state } },
      },
    })}\n`)
  }
  writeFileSync(join(home, 'storages', 'harness_marks.json'), `${JSON.stringify({
    unit: { name: 'harness_marks', version: 1 },
    global: null,
    tables: { marks: options.marks ?? {} },
  })}\n`)
  return { root, home, id }
}

/** Run the exporter and parse its stdout lines. */
function exportFixture(home, args = []) {
  const result = spawnSync(process.execPath, [exporter, '--home', home, ...args], { encoding: 'utf8' })
  assert.equal(result.signal, null)
  const rows = result.stdout.trim() === '' ? [] : result.stdout.trim().split('\n').map(line => JSON.parse(line))
  return { ...result, rows }
}

test('refolds a session log into one export row', t => {
  const fixtureRoot = fixture()
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.rows.length, 1)
  const row = result.rows[0]
  assert.equal(row.session, fixtureRoot.id)
  assert.equal(row.turns, 1)
  assert.equal(row.steps, 1)
  assert.equal(row.toolCalls, 1)
  assert.equal(row.toolErrors, 0)
  // Cost comes from input/output/cacheRead, never from `totalTokens`.
  assert.equal(row.inputTokens, 100)
  assert.equal(row.outputTokens, 10)
  assert.equal(row.cacheReadTokens, 5)
  assert.equal(row.messages, 1)
  assert.equal(row.firstIncompleteTurn, null)
  assert.equal(row.bifurcate.turn, null)
  assert.deepEqual(row.harness, { cwd: 'D:/work', agentPreset: 'cordis', createdAt: 10 })
  assert.deepEqual(row.marks, [])
})

test('an interrupted turn is not reported as a breakdown or a fork point', t => {
  const id = 'session-test'
  const fixtureRoot = fixture({ events: [
    header(id),
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'tool/call', seq: 2, data: { turn: 1, step: 0, callId: 'c1', name: 'read', arguments: '{"p":"a"}' } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'interrupted' } } },
    { type: 'turn/start', seq: 4, data: { turn: 2 } },
    { type: 'tool/call', seq: 5, data: { turn: 2, step: 0, callId: 'c2', name: 'read', arguments: '{"p":"b"}' } },
    { type: 'turn/end', seq: 6, data: { turn: 2, reason: { kind: 'error' } } },
    { type: 'turn/start', seq: 7, data: { turn: 3 } },
    { type: 'turn/end', seq: 8, data: { turn: 3, reason: { kind: 'interrupted' } } },
  ] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  // Turn 1 was interrupted, so the first REAL breakdown is turn 2.
  assert.equal(result.rows[0].firstIncompleteTurn, 2)
  assert.equal(result.rows[0].bifurcate.turn, 2)
})

test('separates infrastructure retries from tool errors', t => {
  const id = 'session-test'
  const fixtureRoot = fixture({ events: [
    header(id),
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'llm/retry', seq: 2, data: { turn: 1, step: 0, failure: { code: 'TRANSPORT' } } },
    { type: 'llm/retry', seq: 3, data: { turn: 1, step: 0, failure: { code: 'TRANSPORT' } } },
    { type: 'tool/result', seq: 4, data: { turn: 1, step: 0, message: { isError: true }, error: { code: 'FS_NOT_OBSERVED' } } },
    { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.rows[0].retries, 2)
  assert.deepEqual(result.rows[0].retryCodes, { TRANSPORT: 2 })
  assert.deepEqual(result.rows[0].errorCodes, { FS_NOT_OBSERVED: 1 })
  assert.equal(result.rows[0].toolErrors, 1)
})

test('repeated identical calls are counted', t => {
  const id = 'session-test'
  const call = (seq, args) => ({ type: 'tool/call', seq, data: { turn: 1, step: 0, callId: `c${seq}`, name: 'get_window_state', arguments: args } })
  const fixtureRoot = fixture({ events: [
    header(id),
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    call(2, '{"pid":1}'),
    call(3, '{"pid":1}'),
    call(4, '{"pid":1}'),
    call(5, '{"pid":2}'),
    { type: 'turn/end', seq: 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.rows[0].repeats, 2, 'two re-issues of {"pid":1}; {"pid":2} is a different intent')
})

test('a log that repeats an event seq is folded once', t => {
  const id = 'session-test'
  // A restart mid-turn can republish an event. Folding it twice would double the
  // tokens, which the live projection never does.
  const fixtureRoot = fixture({ events: [
    header(id),
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
  ] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.rows[0].inputTokens, 100)
  assert.equal(result.rows[0].messages, 1)
})

test('skips an older Session format', t => {
  const fixtureRoot = fixture({ events: [
    { type: 'session', version: 3, id: 'session-test', createdAt: 1, isSeeded: false, delegationDepth: 0 },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
  ] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 2)
  assert.equal(result.rows.length, 0)
  assert.match(result.stderr, /oldFormat/)
})

test('skips a Session with no turns by default and includes it on request', t => {
  const fixtureRoot = fixture({ events: [header('session-test')] })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const skipped = exportFixture(fixtureRoot.home)
  assert.equal(skipped.status, 2)
  assert.equal(skipped.rows.length, 0)
  const included = exportFixture(fixtureRoot.home, ['--include-empty'])
  assert.equal(included.status, 0, included.stderr)
  assert.equal(included.rows.length, 1)
  assert.equal(included.rows[0].turns, 0)
})

test('merges durable marks in creation order', t => {
  const fixtureRoot = fixture({ marks: {
    later: { id: 'later', sessionId: 'session-test', turn: 1, kind: 'note', reason: 'later observation', createdAt: 20, harness: {} },
    earlier: { id: 'earlier', sessionId: 'session-test', turn: 1, kind: 'failure', reason: 'first observation', createdAt: 10, harness: { cwd: 'D:/work' } },
  } })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.rows[0].marks, [
    { turn: 1, kind: 'failure', reason: 'first observation' },
    { turn: 1, kind: 'note', reason: 'later observation' },
  ])
})

test('the output file has one parseable row and no undefined values', t => {
  const fixtureRoot = fixture()
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const out = join(fixtureRoot.root, 'evidence.jsonl')
  const result = spawnSync(process.execPath, [exporter, '--home', fixtureRoot.home, '--out', out], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const lines = readFileSync(out, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  const parsed = JSON.parse(lines[0])
  assert.equal(JSON.stringify(parsed).includes('undefined'), false)
  assert.equal(parsed.session, fixtureRoot.id)
})

// --- the cache path, kept for cross-checking ---------------------------------

test('--from-cache still exports a current cache row', t => {
  const fixtureRoot = fixture({ withCache: true })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home, ['--from-cache'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].turns, 1)
  assert.equal(result.rows[0].steps, 2)
})

test('--from-cache skips a row an older evidence version wrote', t => {
  const fixtureRoot = fixture({ withCache: true, evidenceVersion: 4 })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home, ['--from-cache'])
  assert.equal(result.status, 2)
  assert.equal(result.rows.length, 0)
  assert.match(result.stderr, /oldEvidence/)
})

test('--from-cache skips a record from an older Session format', t => {
  const fixtureRoot = fixture({ withCache: true, formatVersion: 3 })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home, ['--from-cache'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /oldFormat/)
})

test('--from-cache skips a record whose Session directory was deleted', t => {
  const fixtureRoot = fixture({ withCache: true, includeSession: false })
  t.after(() => rmSync(fixtureRoot.root, { recursive: true, force: true }))
  const result = exportFixture(fixtureRoot.home, ['--from-cache'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /orphaned/)
})
