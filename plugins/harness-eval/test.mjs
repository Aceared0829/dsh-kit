/**
 * Regression tests for the `harnessEvidence` projection unit.
 *
 * Two failures motivated these, both from the same root cause: a value that
 * JSON cannot represent losslessly (`undefined`) reaching a durable or wire
 * boundary.
 *
 *   1. The projection cache rejected the state, so the row was never written.
 *   2. The gateway rejected `api-session/added`, which rolled back the whole
 *      new Session: the sidebar showed a row but the composer was unavailable.
 *
 * Both are silent at the type level and catastrophic at the product level, so
 * every case below asserts lossless JSON on BOTH the state and the wire view.
 *
 *   node --test plugins/harness-eval/test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const module = await import('./lib/index.js')

/** Collect `undefined`-valued paths; JSON drops these silently. */
function undefinedPaths(value, path = '$', out = []) {
  if (value === undefined) {
    out.push(path)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach((item, index) => undefinedPaths(item, `${path}[${index}]`, out))
    return out
  }
  for (const key of Object.keys(value)) undefinedPaths(value[key], `${path}.${key}`, out)
  return out
}

/**
 * Assert a value survives `JSON.parse(JSON.stringify(...))` with no property
 * lost, reordered away, or collapsed from `undefined`.
 */
function assertLossless(value, label) {
  const missing = undefinedPaths(value)
  assert.deepEqual(missing, [], `${label} carries undefined at: ${missing.join(', ')}`)
  const json = JSON.stringify(value)
  assert.notEqual(json, undefined, `${label} is not JSON-serializable`)
  assert.equal(JSON.stringify(JSON.parse(json)), json, `${label} does not round-trip through JSON`)
}

/**
 * Register the unit against a stub registry and return its definition.
 *
 * `apply` also mounts the marks service; the stub records the request instead
 * of constructing a service, because these tests cover the fold, not storage.
 */
function registeredUnit() {
  let definition
  const harnessMarks = { marksFor: () => [] }
  const ctx = {
    sessionProjections: { register: (value) => { definition = value; return () => {} } },
    // The marks service is mounted by `apply`; it needs a real Context.
    plugin: () => {},
    get: name => name === 'harnessMarks' ? harnessMarks : undefined,
    effect: () => () => {},
  }
  module.apply(ctx)
  assert.ok(definition !== undefined, 'apply must register a projection unit')
  return definition
}

const unit = registeredUnit()
const event = (type, data, seq) => ({ type, data, seq })
/** A header as the session store mints it for a blank session. */
const blankHeader = () => ({ version: 1, id: 'session-1', createdAt: 1, isSeeded: false })

test('the plugin exports the Cordis function-plugin shape', () => {
  assert.equal(module.name, 'harness-eval')
  assert.deepEqual(module.inject, ['sessionProjections'])
  assert.equal(typeof module.apply, 'function')
})

test('the projection reads marks without declaring harnessMarks in inject', () => {
  // The plugin mounts harnessMarks itself; requiring it in inject would make
  // this fiber wait on its own child. Reading through the property proxy
  // throws "cannot get property ... without inject", so the reader must use
  // ctx.get and resolve the mounted service after Cordis publishes it.
  assert.equal(module.inject.includes('harnessMarks'), false)
  let captured
  const ctx = {
    sessionProjections: { register: value => { captured = value; return () => {} } },
    plugin: () => {},
    get: name => name === 'harnessMarks'
      ? { marksFor: sessionId => [{ id: 'm1', sessionId, turn: 1, kind: 'note', reason: 'seen', createdAt: 2 }] }
      : undefined,
    effect: fn => fn(),
  }
  module.apply(ctx)
  const state = captured.init(blankHeader())
  const view = captured.wire.view(state)
  assert.deepEqual(view.marks, [{ id: 'm1', turn: 1, kind: 'note', reason: 'seen', createdAt: 2 }])
})

test('the projection renders no marks when the marks service is unavailable', () => {
  // The projection definition outlives any one service instance. A disposed
  // or not-yet-published marks service must degrade to an empty list instead
  // of failing the whole session projection.
  let captured
  const ctx = {
    sessionProjections: { register: value => { captured = value; return () => {} } },
    plugin: () => {},
    get: () => undefined,
    effect: fn => fn(),
  }
  module.apply(ctx)
  const state = captured.init(blankHeader())
  const view = captured.wire.view(state)
  assert.deepEqual(view.marks, [])
  assertLossless(view, 'view without harnessMarks')
})

test('the unit declares a positive stateVersion', () => {
  assert.equal(unit.key, 'harnessEvidence')
  assert.ok(Number.isSafeInteger(unit.stateVersion) && unit.stateVersion >= 1)
  assert.equal(typeof unit.apply, 'function')
  assert.equal(typeof unit.init, 'function')
  assert.equal(typeof unit.wire.view, 'function')
})

test('blank session: state and view are lossless JSON', () => {
  const state = unit.init(blankHeader())
  assertLossless(state, 'state')
  assertLossless(unit.wire.view(state), 'view')
})

test('blank session omits absent optional harness fields instead of writing undefined', () => {
  const view = unit.wire.view(unit.init(blankHeader()))
  assert.equal('cwd' in view.harness, false, 'an absent cwd must not appear as a key')
  assert.equal('agentPreset' in view.harness, false)
  assert.equal('parentSession' in view.harness, false)
  assert.equal(view.harness.createdAt, 1)
})

test('present optional harness fields survive verbatim', () => {
  const view = unit.wire.view(unit.init({
    ...blankHeader(),
    cwd: 'D:/workspace',
    agentPreset: 'cordis',
    parentSession: 'session-0',
  }))
  assert.equal(view.harness.cwd, 'D:/workspace')
  assert.equal(view.harness.agentPreset, 'cordis')
  assert.equal(view.harness.parentSession, 'session-0')
  assertLossless(view, 'view')
})

test('an open turn keeps lossless JSON in both state and view', () => {
  const state = unit.apply(unit.init(blankHeader()), event('turn/start', { turn: 1 }, 1))
  assertLossless(state, 'state')
  assertLossless(unit.wire.view(state), 'view')
})

test('an open turn omits outcome from the view but marks it internally', () => {
  const state = unit.apply(unit.init(blankHeader()), event('turn/start', { turn: 1 }, 1))
  assert.equal(state.turns[0].outcome, null, 'state marks an open turn with null')
  const view = unit.wire.view(state)
  assert.equal('outcome' in view.turns[0], false, 'view omits the outcome of an open turn')
})

test('mixed closed and open turns stay lossless JSON', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('step/start', { turn: 1, step: 0 }, 2))
  state = unit.apply(state, event('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'read', arguments: '{}' }, 3))
  state = unit.apply(state, event('tool/result', { turn: 1, step: 0, message: { isError: true } }, 4))
  state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
  state = unit.apply(state, event('turn/start', { turn: 2 }, 6))
  assertLossless(state, 'state')
  assertLossless(unit.wire.view(state), 'view')
})

test('a closed turn maps its end reason onto the outcome vocabulary', () => {
  const outcomeFor = (reason) => {
    let state = unit.init(blankHeader())
    state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
    state = unit.apply(state, event('turn/end', { turn: 1, reason }, 2))
    return unit.wire.view(state).turns[0].outcome
  }
  assert.equal(outcomeFor({ kind: 'completed' }), 'completed')
  assert.equal(outcomeFor({ kind: 'aborted', reason: { kind: 'user' } }), 'aborted')
  assert.equal(outcomeFor({ kind: 'error', error: { message: 'x', code: 'UNKNOWN' } }), 'failed')
  assert.equal(outcomeFor({ kind: 'max-tokens' }), 'truncated')
  assert.equal(outcomeFor({ kind: 'blocked' }), 'other')
  // `interrupted` used to fold to 'other' and therefore counted as a breakdown.
  // On real data that made 46% of all "breakdowns" turns the person simply
  // cancelled, which inflated every fork estimate. It now keeps its own name.
  assert.equal(outcomeFor({ kind: 'interrupted' }), 'interrupted')
})

test('only a real breakdown is a fork point, never a person stopping the run', () => {
  const forkFor = (kinds) => {
    let state = unit.init(blankHeader())
    let seq = 1
    kinds.forEach((kind, index) => {
      state = unit.apply(state, event('turn/start', { turn: index + 1 }, seq++))
      state = unit.apply(state, event('turn/end', { turn: index + 1, reason: { kind } }, seq++))
    })
    return unit.wire.view(state).bifurcate.turn
  }
  assert.equal(forkFor(['completed', 'error']), 2, 'an error turn is a fork point')
  assert.equal(forkFor(['completed', 'interrupted']), null, 'an interrupted turn is not a fork point')
  assert.equal(forkFor(['aborted']), null, 'an aborted turn is not a fork point')
  assert.equal(forkFor(['completed', 'max-tokens']), 2, 'a truncated turn is a fork point')
  assert.equal(forkFor(['interrupted', 'error']), 2, 'the first REAL breakdown wins, skipping the interruption')
})

test('token usage is summed per turn and per session, never from totalTokens', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  // Real logs carry a `totalTokens` that is a running total: on this machine it
  // disagreed with input+output on 1187 of 1193 messages. Summing it would
  // multiply the true figure, so the fold must ignore it entirely.
  state = unit.apply(state, event('assistant/message', { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 999999, cacheReadTokens: 7 } }, 2))
  state = unit.apply(state, event('turn/start', { turn: 2 }, 3))
  state = unit.apply(state, event('assistant/message', { turn: 2, step: 0, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 999999, cacheReadTokens: 3 } }, 4))
  const view = unit.wire.view(state)
  assert.equal(view.totals.inputTokens, 105)
  assert.equal(view.totals.outputTokens, 12)
  assert.equal(view.totals.cacheReadTokens, 10)
  assert.equal(view.totals.messages, 2)
  assert.equal(view.turns[0].usage.input, 100, 'a message attributes to the turn that was open')
  assert.equal(view.turns[0].usage.output, 10)
  assert.equal(view.turns[1].usage.input, 5)
})

test('infrastructure retries stay apart from tool errors', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('llm/retry', { turn: 1, step: 0, failure: { code: 'TRANSPORT', message: 'stream ended' } }, 2))
  state = unit.apply(state, event('llm/retry', { turn: 1, step: 1, failure: { code: 'TRANSPORT', message: 'stream ended' } }, 3))
  state = unit.apply(state, event('llm/retry', { turn: 1, step: 2, failure: { code: 'RATE_LIMIT', message: 'slow down' } }, 4))
  const view = unit.wire.view(state)
  assert.equal(view.retries, 3)
  assert.deepEqual(view.retryCodes, { TRANSPORT: 2, RATE_LIMIT: 1 })
  // A transport hiccup is not the agent being wrong.
  assert.equal(view.totals.toolErrors, 0)
  assert.equal(view.turns[0].retries, 3)
})

test('tool errors are grouped by machine code', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  const failed = (code, seq) => event('tool/result', { turn: 1, step: 0, message: { isError: true }, error: { code } }, seq)
  state = unit.apply(state, failed('FS_NOT_OBSERVED', 2))
  state = unit.apply(state, failed('FS_NOT_OBSERVED', 3))
  state = unit.apply(state, failed('UNKNOWN_TOOL', 4))
  // A tool that fails without a code still has to be counted somewhere.
  state = unit.apply(state, event('tool/result', { turn: 1, step: 0, message: { isError: true } }, 5))
  assert.deepEqual(unit.wire.view(state).errorCodes, { FS_NOT_OBSERVED: 2, UNKNOWN_TOOL: 1, uncoded: 1 })
})

test('an identical call re-issued counts as a repeat, the first call does not', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  const call = (seq, name, args) => event('tool/call', { turn: 1, step: 0, callId: `c${seq}`, name, arguments: args }, seq)
  // Same name and same raw arguments: the "experience did not accumulate" case.
  state = unit.apply(state, call(2, 'cua_driver_native__get_window_state', '{"pid":1}'))
  assert.equal(unit.wire.view(state).repeats, 0, 'the first call is not a repeat')
  state = unit.apply(state, call(3, 'cua_driver_native__get_window_state', '{"pid":1}'))
  assert.equal(unit.wire.view(state).repeats, 1)
  state = unit.apply(state, call(4, 'cua_driver_native__get_window_state', '{"pid":1}'))
  assert.equal(unit.wire.view(state).repeats, 2)
  // Same tool, different arguments: a different intent, not a repeat.
  state = unit.apply(state, call(5, 'cua_driver_native__get_window_state', '{"pid":2}'))
  assert.equal(unit.wire.view(state).repeats, 2)
  assertLossless(state, 'state')
})

test('the repeat map stays bounded so a long session cannot bloat the row', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  for (let index = 0; index < 3000; index += 1) {
    state = unit.apply(state, event('tool/call', { turn: 1, step: 0, callId: `c${index}`, name: 'read', arguments: `{"n":${index}}` }, index + 2))
  }
  const keys = Object.keys(state.repeatCounts).length
  assert.ok(keys <= 512, `repeatCounts must stay bounded, got ${keys}`)
  assert.ok(JSON.stringify(state).length < 400000, 'a bounded repeat map must not bloat the persisted row')
})

test('the harness signature captures what the harness was', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('request/header', { header: { tools: [{ name: 'read' }, { name: 'write' }], config: { provider: 'workbuddy', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' } } }, 1))
  state = unit.apply(state, event('system/message', { message: { content: [{ type: 'text', text: 'abcd' }] } }, 2))
  const signature = unit.wire.view(state).signature
  assert.equal(signature.toolCount, 2)
  assert.equal(signature.provider, 'workbuddy')
  assert.equal(signature.model, 'deepseek-v4.1-flash')
  assert.equal(signature.reasoningEffort, 'max')
  assert.equal(signature.promptChars, 4)
  assert.equal(signature.toolsHash.length, 8)
  assert.equal(signature.promptHash.length, 8)
  // Order must not change the tool hash: the same tool set is the same harness.
  let reordered = unit.init(blankHeader())
  reordered = unit.apply(reordered, event('request/header', { header: { tools: [{ name: 'write' }, { name: 'read' }], config: {} } }, 1))
  assert.equal(unit.wire.view(reordered).signature.toolsHash, signature.toolsHash)
})

test('a signature is captured once and not overwritten by later requests', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('request/header', { header: { tools: [{ name: 'read' }], config: { provider: 'a' } } }, 1))
  state = unit.apply(state, event('request/header', { header: { tools: [{ name: 'x' }, { name: 'y' }], config: { provider: 'b' } } }, 2))
  const signature = unit.wire.view(state).signature
  assert.equal(signature.toolCount, 1)
  assert.equal(signature.provider, 'a')
})

test('an interrupt-only session reports no fork point and no tail share', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('tool/call', { turn: 1, step: 0, callId: 'c', name: 'read', arguments: '{}' }, 2))
  state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'interrupted' } }, 3))
  const view = unit.wire.view(state)
  assert.equal(view.bifurcate.turn, null)
  assert.equal(view.bifurcate.tailTokenShare, null)
  assertLossless(state, 'state')
  assertLossless(view, 'view')
})

test('a non-advancing turn boundary does not add a row', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 3 }, 1))
  const before = state
  state = unit.apply(state, event('turn/start', { turn: 3 }, 2))
  assert.equal(state, before, 'a duplicate opener must return the same state reference')
})

test('only isError tool results count as tool errors', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('tool/result', { turn: 1, step: 0, message: { isError: false } }, 2))
  assert.equal(state.totalToolErrors, 0)
  state = unit.apply(state, event('tool/result', { turn: 1, step: 0, message: {} }, 3))
  assert.equal(state.totalToolErrors, 0)
  state = unit.apply(state, event('tool/result', { turn: 1, step: 0, message: { isError: true } }, 4))
  assert.equal(state.totalToolErrors, 1)
})

test('events the unit ignores keep the state reference', () => {
  const state = unit.init(blankHeader())
  assert.equal(unit.apply(state, event('user/message', {}, 1)), state)
  assert.equal(unit.apply(state, event('assistant/message', {}, 2)), state)
  assert.equal(unit.apply(state, event('step/end', { turn: 1, step: 0 }, 3)), state)
})

test('firstIncompleteTurn names the first turn that did not complete', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
  state = unit.apply(state, event('turn/start', { turn: 2 }, 3))
  state = unit.apply(state, event('turn/end', { turn: 2, reason: { kind: 'error', error: { message: 'x', code: 'U' } } }, 4))
  assert.equal(unit.wire.view(state).firstIncompleteTurn, 2)
})

test('firstIncompleteTurn is absent when every closed turn completed', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 2))
  const view = unit.wire.view(state)
  assert.equal('firstIncompleteTurn' in view, false, 'a clean session must omit the key, not carry undefined')
})

test('idleTurns counts the trailing run of closed, work-free, incomplete turns', () => {
  let state = unit.init(blankHeader())
  // Turn 1 completes with work: it stops the count from the tail.
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('tool/call', { turn: 1, step: 0, callId: 'c', name: 'read', arguments: '{}' }, 2))
  state = unit.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
  assert.equal(unit.wire.view(state).idleTurns, 0)
  // Two aborted, work-free turns at the tail.
  for (const turn of [2, 3]) {
    state = unit.apply(state, event('turn/start', { turn }, 10 + turn))
    state = unit.apply(state, event('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'user' } } }, 20 + turn))
  }
  assert.equal(unit.wire.view(state).idleTurns, 2)
  assertLossless(state, 'state')
  assertLossless(unit.wire.view(state), 'view')
})

test('the wire view carries the fields whose addition bumped stateVersion', () => {
  // `stateVersion` is the cache-invalidation signal: a row written by an older
  // version is discarded and refolded. It must be bumped whenever a field the
  // view publishes changes meaning or appears, or a stale row is served as
  // current. This asserts the current contract so a structural change here
  // fails loudly instead of silently reusing old rows.
  assert.equal(unit.stateVersion, 5, 'bump stateVersion when the view contract changes')
  const view = unit.wire.view(unit.init(blankHeader()))
  for (const key of [
    'harness', 'totals', 'turns', 'idleTurns', 'bifurcate', 'marks',
    // Added at version 5: cost, repeat fingerprints, and the two retry classes.
    'repeats', 'retries', 'retryCodes', 'errorCodes',
  ]) {
    assert.ok(key in view, `the view must publish "${key}" at stateVersion 5`)
  }
  for (const key of ['turn', 'tailSteps', 'tailToolCalls', 'tailShare', 'tailTokenShare', 'tailInputTokens', 'tailOutputTokens']) {
    assert.ok(key in view.bifurcate, `bifurcate must publish "${key}"`)
  }
  for (const key of ['turns', 'steps', 'toolCalls', 'toolErrors', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'messages']) {
    assert.ok(key in view.totals, `totals must publish "${key}"`)
  }
  assert.ok(Array.isArray(view.marks), 'marks is always an array, empty before any is recorded')
  assertLossless(view, 'view')
})

test('a mark read that throws cannot break the session projection', () => {
  // `wire.view` runs inside the projection registry for every session. A throw
  // there failed the whole projection and made the session unloadable (this
  // happened once, via a strict `ctx.<service>` access). The reader must
  // contain every failure instead.
  let definition
  module.apply({
    sessionProjections: { register: (value) => { definition = value; return () => {} } },
    plugin: () => {},
    get: () => ({ marksFor: () => { throw new Error('marks are unavailable') } }),
    effect: () => () => {},
  })
  const state = unit.apply(unit.init(blankHeader()), event('turn/start', { turn: 1 }, 1))
  let view
  assert.doesNotThrow(() => { view = definition.wire.view(state) })
  assert.deepEqual(view.marks, [], 'a failed read must read as no marks')
})

test('a missing marks service cannot break the session projection', () => {
  let definition
  module.apply({
    sessionProjections: { register: (value) => { definition = value; return () => {} } },
    plugin: () => {},
    get: () => undefined,
    effect: () => () => {},
  })
  const state = unit.apply(unit.init(blankHeader()), event('turn/start', { turn: 1 }, 1))
  assert.doesNotThrow(() => definition.wire.view(state))
})

test('apply mounts harnessMarks as a child service on a real Context', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  const domain = {
    table: () => ({ entries: () => [], put: async () => {}, delete: async () => false }),
    close: async () => {},
  }
  const storageDomain = ctx.provide('storageDomain', { open: async () => domain })
  ctx.provide('sessionProjections', { register: () => () => {} })
  try {
    const fiber = ctx.plugin(module)
    await fiber
    assert.ok(ctx.get('harnessMarks'), 'the marks service must be published under the expected key')
    assert.equal(ctx.get('harnessMarks').ping(), 'pong')
  } finally {
    storageDomain()
  }
})

test('a session with no id reads no marks rather than guessing', () => {
  const state = unit.init(blankHeader())
  const bare = { ...state, sessionId: '' }
  assert.deepEqual(unit.wire.view(bare).marks, [])
})

test('a cold restore can refold the log from init', () => {
  const state = unit.init(blankHeader())
  assert.deepEqual(state.turns, [])
  assert.equal(state.totalSteps, 0)
  assertLossless(state, 'state')
})

/** Fold a turn with a given end reason and step count. */
function addTurn(state, turn, reason, steps) {
  let next = unit.apply(state, event('turn/start', { turn }, turn * 100))
  for (let index = 0; index < steps; index += 1) {
    next = unit.apply(next, event('step/start', { turn, step: index }, turn * 100 + index + 1))
  }
  return unit.apply(next, event('turn/end', { turn, reason }, turn * 100 + 90))
}

test('bifurcate names the fork point and the cost of re-running the tail', () => {
  let state = unit.init(blankHeader())
  state = addTurn(state, 1, { kind: 'completed' }, 12)
  state = addTurn(state, 2, { kind: 'completed' }, 9)
  state = addTurn(state, 3, { kind: 'error', error: { message: 'x', code: 'U' } }, 8)
  state = addTurn(state, 4, { kind: 'error', error: { message: 'x', code: 'U' } }, 5)
  const { bifurcate, totals } = unit.wire.view(state)
  assert.equal(bifurcate.turn, 3, 'the fork point is the first turn that did not complete')
  assert.equal(bifurcate.tailSteps, 13, 'the tail covers the fork turn and everything after it')
  assert.equal(totals.steps, 34)
  assert.equal(bifurcate.tailShare, 38, 'the share is rounded, and 13/34 rounds to 38')
})

test('bifurcate reports a null fork point for a session that never broke', () => {
  let state = unit.init(blankHeader())
  state = addTurn(state, 1, { kind: 'completed' }, 4)
  state = addTurn(state, 2, { kind: 'completed' }, 6)
  const { bifurcate } = unit.wire.view(state)
  // null, not absent: the client distinguishes "nothing to fork from" from
  // "this host has not published the field".
  assert.equal(bifurcate.turn, null)
  assert.equal(bifurcate.tailSteps, 0)
})

test('bifurcate reports a null share when the session ran no steps', () => {
  let state = unit.init(blankHeader())
  state = addTurn(state, 1, { kind: 'error', error: { message: 'x', code: 'U' } }, 0)
  const { bifurcate } = unit.wire.view(state)
  assert.equal(bifurcate.turn, 1)
  // 0/0 has no meaning; null says so instead of reporting a misleading 0%.
  assert.equal(bifurcate.tailShare, null)
})

test('the wire view carrying bifurcate stays lossless JSON', () => {
  let state = unit.init(blankHeader())
  state = addTurn(state, 1, { kind: 'completed' }, 3)
  state = addTurn(state, 2, { kind: 'error', error: { message: 'x', code: 'U' } }, 2)
  state = unit.apply(state, event('turn/start', { turn: 3 }, 300))
  assertLossless(state, 'state')
  assertLossless(unit.wire.view(state), 'view')
})

test('bifurcate with no steps at all in a clean session stays lossless', () => {
  const state = unit.init(blankHeader())
  const view = unit.wire.view(state)
  assert.equal(view.bifurcate.turn, null)
  assert.equal(view.bifurcate.tailShare, null)
  assertLossless(view, 'view')
})

test('a guard denial is counted apart from agent mistakes', () => {
  // A tool guard has no way to attach an error code, so without this
  // classification a denial this plugin caused would be counted as the model
  // failing — and the evaluation would blame the agent for a number the plugin
  // chose.
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('tool/result', {
    turn: 1, step: 0,
    message: {
      isError: true,
      content: [{ type: 'text', text: 'You just called cua_driver_native__get_window_state with exactly these arguments, and nothing acted on the window since.' }],
    },
  }, 2))
  const view = unit.wire.view(state)
  assert.equal(view.guardDenials, 1)
  assert.equal(view.errorCodes['guard/repeated-observation'], 1)
  // It is still a tool error for accounting purposes, but it has its own bucket.
  assert.equal(view.totals.toolErrors, 1)
  assert.equal('uncoded' in view.errorCodes, false, 'a denial must not also be counted as uncoded')
})

test('an ordinary tool error is not misread as a guard denial', () => {
  let state = unit.init(blankHeader())
  state = unit.apply(state, event('turn/start', { turn: 1 }, 1))
  state = unit.apply(state, event('tool/result', {
    turn: 1, step: 0,
    message: { isError: true, content: [{ type: 'text', text: 'FS_NOT_OBSERVED: read the file first' }] },
    error: { code: 'FS_NOT_OBSERVED' },
  }, 2))
  const view = unit.wire.view(state)
  assert.equal(view.guardDenials, 0)
  assert.deepEqual(view.errorCodes, { FS_NOT_OBSERVED: 1 })
})