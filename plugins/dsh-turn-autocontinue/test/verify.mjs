/**
 * Verification for @local/dsh-turn-autocontinue.
 *
 * Every case drives the real plugin through a fake Cordis context: fake
 * `agent/error` and `session/event` dispatchers, a fake Session that records
 * appends, and a fake Agent whose followup() is counted. Time is fake, so the
 * backoff and the idle wait are deterministic and the suite is instant.
 *
 * Run: node test/verify.mjs
 */

import assert from 'node:assert/strict'

const plugin = await import('../lib/index.js')

/** Yield until every pending microtask and promise chain has run. */
async function drainMicrotasks() {
  for (let tick = 0; tick < 64; tick += 1) await new Promise(resolve => setImmediate(resolve))
}

let passed = 0
let failed = 0
const failures = []

async function test(title, body) {
  try {
    await body()
    passed += 1
    console.log('  PASS  ' + title)
  } catch (error) {
    failed += 1
    failures.push({ title, error })
    console.log('  FAIL  ' + title)
    console.log('        ' + (error && error.message ? error.message : String(error)))
  }
}

/** Fake timers: scheduled callbacks run only when the test advances the clock. */
function createClock() {
  let current = 0
  let nextId = 1
  const pending = new Map()
  return {
    now: () => current,
    schedule(run, ms) {
      const id = nextId++
      pending.set(id, { run, at: current + ms, ms })
      return id
    },
    cancelScheduled(id) {
      pending.delete(id)
    },
    async sleep(ms) {
      current += ms
    },
    get scheduledCount() {
      return pending.size
    },
    /** Delays of callbacks still pending, in scheduling order. */
    scheduledDelays() {
      return [...pending.values()].map(item => item.ms)
    },
    /** Fire the earliest pending callback, advancing the clock to its deadline. */
    async fireEarliest() {
      const entries = [...pending.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])
      if (entries.length === 0) throw new Error('no scheduled callback to fire')
      const [id, item] = entries[0]
      pending.delete(id)
      current = Math.max(current, item.at)
      item.run()
      // Let the whole async delivery chain settle: delivery awaits the bounded idle
      // loop, whose fake sleep resolves immediately but still yields.
      await drainMicrotasks()
      return item
    },
    async fireAll() {
      while (pending.size > 0) await this.fireEarliest()
    },
  }
}

/** Build a fake plugin context plus one fake agent/session pair. */
function createHarness(config = {}) {
  const clock = createClock()
  const listeners = new Map()
  const appends = []
  const followups = []
  const warnings = []
  // Identities this fake inbox is holding, so the loop's claim/discard can be replayed.
  const queued = []
  let disposed = null

  const session = {
    id: 'session-under-test',
    append(type, data, opts) {
      if (type !== 'user/message') throw new Error('unexpected append type ' + type)
      // A reentrant append during publication is what the real Session rejects; the
      // plugin must never attempt one, so record it loudly instead of silently passing.
      if (emitting) throw new Error('reentrant Session.append during session/event publication')
      appends.push({ data, opts })
      return { type, seq: appends.length - 1 }
    },
  }

  const agent = {
    id: 'session-under-test',
    session,
    status: 'idle',
    inbox: { hasPending: false },
    followup(message) {
      followups.push(message)
      agent.status = 'running'
      agent.inbox = { hasPending: true }
      queued.push(message.id)
    },
    isLive: true,
  }

  const ctx = {
    logger: {
      warn(text) {
        warnings.push(text)
      },
    },
    on(event, handler) {
      const list = listeners.get(event) ?? []
      list.push(handler)
      listeners.set(event, list)
      return () => {
        const current = listeners.get(event) ?? []
        listeners.set(event, current.filter(candidate => candidate !== handler))
      }
    },
    effect(factory) {
      disposed = factory()
      return disposed
    },
    agents: {
      get(id) {
        return id === agent.id && agent.isLive ? agent : undefined
      },
    },
  }

  let emitting = false

  function emit(event, ...args) {
    const list = listeners.get(event) ?? []
    for (const handler of list) handler(...args)
  }

  /** Drive one turn that ends with the given reason, as the loop does. */
  function endTurn(turn, reason, error) {
    // Opening the turn first is what the real loop always does.
    emitting = true
    try {
      emit('session/event', session, { type: 'turn/start', data: { turn } })
    } finally {
      emitting = false
    }
    if (error !== undefined) emit('agent/error', { agent, turn, step: 1, error })
    emitting = true
    try {
      emit('session/event', session, { type: 'turn/end', data: { turn, reason } })
    } finally {
      emitting = false
    }
  }

  /** Simulate the loop claiming the queued continuation for its turn. */
  function claimQueued() {
    const id = queued.shift()
    if (id === undefined) throw new Error('nothing queued to claim')
    agent.inbox = { hasPending: queued.length > 0 }
    emit('agent/inbox/claimed', { agent, message: { id }, turn: 2 })
    return id
  }

  /** Simulate a cancel/disposal discarding the queued continuation before it ran. */
  function discardQueued() {
    const id = queued.shift()
    if (id === undefined) throw new Error('nothing queued to discard')
    agent.inbox = { hasPending: queued.length > 0 }
    emit('agent/inbox/discarded', { agent, message: { id } })
    return id
  }

  /**
   * Simulate the agent finishing the turn that carried the continuation, so the next
   * scenario starts from an idle agent with an empty inbox. Tests that need to replay
   * the inbox lifecycle call claimQueued()/discardQueued() first.
   */
  function settleAgent() {
    queued.length = 0
    agent.status = 'idle'
    agent.inbox = { hasPending: false }
  }

  const disposeFn = plugin.apply(ctx, config, {
    schedule: clock.schedule,
    cancelScheduled: clock.cancelScheduled,
    sleep: clock.sleep,
    now: clock.now,
  })

  return {
    plugin, ctx, agent, session, clock, appends, followups, warnings, queued,
    emit, endTurn, settleAgent, claimQueued, discardQueued,
    dispose() {
      disposeFn()
      agent.isLive = false
    },
  }
}

/** A model-side failure with a stable code, the shape the loop reports. */
function llmFailure(code, message) {
  const error = new Error(message)
  error.code = code
  error.name = 'LlmError'
  error.failure = { code, message }
  return error
}

const MALFORMED = () => llmFailure(
  'MALFORMED_RESPONSE',
  'Model wrote invalid JSON for tool "ask_user" arguments: unexpected token at char 351',
)

console.log('dsh-turn-autocontinue verification')
console.log('')

// ---------------------------------------------------------------------------
console.log('[A] three continuations, then an honest stop')
// ---------------------------------------------------------------------------

await test('A1 first error turn schedules exactly one continuation, on the configured backoff', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad json' } }, MALFORMED())
  assert.equal(h.followups.length, 0, 'no continuation before the backoff elapses')
  assert.deepEqual(h.clock.scheduledDelays(), [2000], 'first delay must be 2000 ms')
  h.dispose()
})

await test('A2 the continuation prompt tells the model to inspect state and not blindly redo', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad json' } }, MALFORMED())
  await h.clock.fireAll()
  assert.equal(h.followups.length, 1, 'exactly one continuation delivered')
  const message = h.followups[0]
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].type, 'text')
  const text = message.content[0].text
  assert.match(text, /1\/3/, 'the prompt names which attempt this is')
  assert.match(text, /MALFORMED_RESPONSE/, 'the prompt names the real cause')
  assert.match(text, /先查看当前状态/, 'the prompt must say to inspect the current state first')
  assert.match(text, /不要盲目重做上一条命令/, 'the prompt must forbid blindly redoing the command')
  assert.equal(message.source.kind, 'turn-autocontinue')
  assert.equal(message.source.phase, 'continue')
  assert.equal(message.source.attempt, 1)
  h.dispose()
})

await test('A3 three consecutive failures continue exactly 3 times, then a 4th failure stops and names count + last cause', async () => {
  const h = createHarness()

  // Turn 1 fails -> continuation 1
  h.endTurn(1, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad json #1' } }, MALFORMED())
  await h.clock.fireAll()
  h.settleAgent()
  assert.equal(h.followups.length, 1)

  // Turn 2 fails -> continuation 2
  h.endTurn(2, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad json #2' } }, MALFORMED())
  await h.clock.fireAll()
  h.settleAgent()
  assert.equal(h.followups.length, 2)

  // Turn 3 fails -> continuation 3
  h.endTurn(3, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'bad json #3' } }, MALFORMED())
  await h.clock.fireAll()
  h.settleAgent()
  assert.equal(h.followups.length, 3, 'the hard ceiling of 3 continuations is reached')

  // Turn 4 fails -> stop, no 4th continuation
  const last = llmFailure('MALFORMED_RESPONSE', 'bad json #4 (the last real one)')
  h.endTurn(4, { kind: 'error', error: last.failure }, last)
  await h.clock.fireAll()
  assert.equal(h.followups.length, 3, 'never a 4th continuation')

  const stopNotices = h.appends.filter(entry => entry.data.source.phase === 'stopped')
  assert.equal(stopNotices.length, 1, 'exactly one durable stop notice')
  const stopText = stopNotices[0].data.content[0].text
  assert.match(stopText, /已连续自动续跑 3 次/, 'the stop notice states the count')
  assert.match(stopText, /bad json #4 \(the last real one\)/, 'the stop notice states the last real cause')
  assert.match(stopText, /MALFORMED_RESPONSE/, 'the stop notice states the last real code')
  h.dispose()
})

await test('A4 the backoff sequence is 2s / 5s / 10s and every continuation is on the record', async () => {
  const h = createHarness()
  const delays = []
  const failures = [
    llmFailure('SERVER', 'upstream 500'),
    llmFailure('TRANSPORT', 'socket hang up'),
    llmFailure('TIMEOUT', 'idle timeout'),
  ]
  for (let attempt = 0; attempt < 3; attempt += 1) {
    h.endTurn(attempt + 1, { kind: 'error', error: failures[attempt].failure }, failures[attempt])
    delays.push(...h.clock.scheduledDelays())
    await h.clock.fireAll()
    h.settleAgent()
  }
  assert.deepEqual(delays, [2000, 5000, 10000], 'declared backoff 2s / 5s / 10s')
  assert.equal(h.followups.length, 3)
  assert.equal(h.warnings.filter(text => text.includes('delivered continuation')).length, 3,
    'each continuation leaves a log trace')
  for (const [index, message] of h.followups.entries()) {
    assert.equal(message.source.attempt, index + 1, 'each prompt carries its own attempt number')
    assert.equal(message.source.maxContinues, 3)
  }
  h.dispose()
})

// ---------------------------------------------------------------------------
console.log('')
console.log('[B] paths that must never continue')
// ---------------------------------------------------------------------------

await test('B1 a user-cancelled turn (turn/end reason aborted) never continues', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'aborted', reason: { kind: 'user' } })
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0, 'no continuation after a user cancel')
  assert.equal(h.clock.scheduledCount, 0, 'nothing was even scheduled')
  h.dispose()
})

await test('B2 a hook-denied turn never continues', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'aborted', reason: { kind: 'hook', reason: 'approval denied by policy' } })
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0)
  h.dispose()
})

await test('B3 an AbortError reported as a turn error never continues', async () => {
  const h = createHarness()
  const abort = new Error('The operation was aborted')
  abort.name = 'AbortError'
  h.endTurn(1, { kind: 'error', error: { code: 'UNKNOWN', message: abort.message } }, abort)
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0)
  h.dispose()
})

await test('B4 a permission-denial code never continues', async () => {
  const h = createHarness()
  const denied = llmFailure('PERMISSION_DENIED', 'the user denied this tool')
  h.endTurn(1, { kind: 'error', error: denied.failure }, denied)
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0)
  h.dispose()
})

await test('B5 a model that cannot serve the request never continues', async () => {
  for (const code of ['MODEL_DOES_NOT_SUPPORT_IMAGES', 'UNSUPPORTED_MODEL', 'NO_ADAPTER']) {
    const h = createHarness()
    const error = llmFailure(code, 'the selected model cannot do this')
    h.endTurn(1, { kind: 'error', error: error.failure }, error)
    await h.clock.fireAll()
    assert.equal(h.followups.length, 0, code + ' must never continue')
    h.dispose()
  }
})

await test('B6 completed, blocked, and max-tokens turns never continue', async () => {
  for (const reason of [{ kind: 'completed' }, { kind: 'blocked' }, { kind: 'max-tokens' }]) {
    const h = createHarness()
    h.endTurn(1, reason)
    await h.clock.fireAll()
    assert.equal(h.followups.length, 0, reason.kind + ' must never continue')
    h.dispose()
  }
})

await test('B7 extra neverContinueCodes from config are honoured', async () => {
  const h = createHarness({ neverContinueCodes: ['MALFORMED_RESPONSE'] })
  h.endTurn(1, { kind: 'error', error: { code: 'MALFORMED_RESPONSE', message: 'x' } }, MALFORMED())
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0)
  h.dispose()
})

// ---------------------------------------------------------------------------
console.log('')
console.log('[C] chain accounting, limits, and lifecycle')
// ---------------------------------------------------------------------------

await test('C1 a human turn between failures resets the budget', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'boom 1' } }, llmFailure('SERVER', 'boom 1'))
  await h.clock.fireAll()
  h.settleAgent()
  assert.equal(h.followups.length, 1)

  // The human sends their own message instead of accepting the continuation.
  h.endTurn(2, { kind: 'completed' })
  await h.clock.fireAll()

  // A later failure is a brand new chain, so the attempt number restarts at 1.
  h.endTurn(3, { kind: 'error', error: { code: 'SERVER', message: 'boom 2' } }, llmFailure('SERVER', 'boom 2'))
  await h.clock.fireAll()
  assert.equal(h.followups.length, 2)
  assert.equal(h.followups[1].source.attempt, 1, 'the budget restarted after the human turn')
  h.dispose()
})

await test('C2 a user cancel after two continuations resets the chain so nothing resumes', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b1' } }, llmFailure('SERVER', 'b1'))
  await h.clock.fireAll()
  h.settleAgent()
  h.endTurn(2, { kind: 'error', error: { code: 'SERVER', message: 'b2' } }, llmFailure('SERVER', 'b2'))
  await h.clock.fireAll()
  h.settleAgent()
  assert.equal(h.followups.length, 2)

  // The user hits stop while continuation 3 runs.
  h.endTurn(3, { kind: 'aborted', reason: { kind: 'user' } })
  await h.clock.fireAll()
  assert.equal(h.followups.length, 2, 'a user cancel must not be followed by a continuation')
  h.dispose()
})

await test('C3 maxContinues is clamped to the hard ceiling of 3', async () => {
  assert.equal(plugin.normalizeConfig({ maxContinues: 99 }).maxContinues, 3)
  assert.equal(plugin.normalizeConfig({ maxContinues: 1 }).maxContinues, 1)
  assert.equal(plugin.normalizeConfig({ maxContinues: -5 }).maxContinues, 0)
  assert.equal(plugin.HARD_MAX_CONTINUES, 3)
  const h = createHarness({ maxContinues: 1 })
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b1' } }, llmFailure('SERVER', 'b1'))
  await h.clock.fireAll()
  h.settleAgent()
  h.endTurn(2, { kind: 'error', error: { code: 'SERVER', message: 'b2' } }, llmFailure('SERVER', 'b2'))
  await h.clock.fireAll()
  assert.equal(h.followups.length, 1, 'a lowered limit is respected')
  assert.equal(h.appends.filter(entry => entry.data.source.phase === 'stopped').length, 1)
  h.dispose()
})

await test('C4 disposal clears pending timers and no continuation is delivered afterwards', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b1' } }, llmFailure('SERVER', 'b1'))
  assert.equal(h.clock.scheduledCount, 1)
  h.dispose()
  assert.equal(h.clock.scheduledCount, 0, 'the pending backoff timer was cancelled')
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0)
})

await test('C5 a continuation is dropped, on the record, when a newer turn owns the agent', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b1' } }, llmFailure('SERVER', 'b1'))
  // A human turn started while the backoff was running.
  h.agent.status = 'running'
  h.agent.inbox = { hasPending: true }
  await h.clock.fireAll()
  assert.equal(h.followups.length, 0, 'never interleave with a running human turn')
  const skipped = h.appends.filter(entry => entry.data.source.phase === 'skipped')
  assert.equal(skipped.length, 1, 'the drop itself is on the record')
  h.dispose()
})

await test('C8 a continuation discarded before its turn runs resets the chain', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b1' } }, llmFailure('SERVER', 'b1'))
  await h.clock.fireAll()
  assert.equal(h.followups.length, 1)
  // A cancel clears the inbox before the owed turn is claimed.
  h.discardQueued()
  h.settleAgent()
  assert.equal(h.warnings.filter(text => text.includes('was discarded')).length, 1,
    'the discard is on the log')

  // The next failure starts a brand new chain: attempt 1 again, not attempt 2.
  h.endTurn(2, { kind: 'error', error: { code: 'SERVER', message: 'b2' } }, llmFailure('SERVER', 'b2'))
  await h.clock.fireAll()
  assert.equal(h.followups.length, 2)
  assert.equal(h.followups[1].source.attempt, 1, 'the budget restarted after the discard')
  h.dispose()
})

await test('C9 a claimed continuation keeps the chain going, so the ceiling still holds', async () => {
  const h = createHarness()
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    h.endTurn(attempt * 2 - 1, { kind: 'error', error: { code: 'SERVER', message: 'b' + attempt } },
      llmFailure('SERVER', 'b' + attempt))
    await h.clock.fireAll()
    h.claimQueued()
    h.settleAgent()
  }
  assert.equal(h.followups.length, 3)
  assert.deepEqual(h.followups.map(message => message.source.attempt), [1, 2, 3],
    'claimed turns do NOT reset the budget')
  h.dispose()
})

await test('C6 chain state is per session, so two sessions keep separate budgets', async () => {
  const h = createHarness()
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'a' } }, llmFailure('SERVER', 'a'))
  await h.clock.fireAll()
  assert.equal(h.followups.length, 1)
  assert.equal(h.followups[0].source.attempt, 1)
  // A second, unrelated session never inherits the first one's attempt counter.
  const other = createHarness()
  other.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'b' } }, llmFailure('SERVER', 'b'))
  await other.clock.fireAll()
  assert.equal(other.followups[0].source.attempt, 1)
  h.dispose()
  other.dispose()
})

await test('C7 every durable append carries a surface operation, so readers can render it', async () => {
  const h = createHarness({ maxContinues: 1 })
  h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'x' } }, llmFailure('SERVER', 'x'))
  await h.clock.fireAll()
  h.settleAgent()
  h.endTurn(2, { kind: 'error', error: { code: 'SERVER', message: 'y' } }, llmFailure('SERVER', 'y'))
  await h.clock.fireAll()
  assert.ok(h.appends.length >= 1, 'the stop notice was recorded')
  for (const entry of h.appends) {
    assert.equal(entry.opts.surfaceOp, 'append')
    assert.equal(entry.data.role, 'user')
    assert.equal(typeof entry.data.id, 'string')
    assert.equal(entry.data.source.kind, 'turn-autocontinue')
  }
  h.dispose()
})

// ---------------------------------------------------------------------------
console.log('')
console.log('[D] pure helpers')
// ---------------------------------------------------------------------------

await test('D1 codeOfFailure reads LlmFailure, HarnessError, and AbortError shapes', async () => {
  assert.equal(plugin.codeOfFailure({ failure: { code: 'RATE_LIMIT', message: 'slow down' } }), 'RATE_LIMIT')
  assert.equal(plugin.codeOfFailure({ code: 'NO_ADAPTER', message: 'x' }), 'NO_ADAPTER')
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  assert.equal(plugin.codeOfFailure(abort), 'ABORTERROR')
  assert.equal(plugin.codeOfFailure('timeout'), 'TIMEOUT')
  assert.equal(plugin.codeOfFailure(undefined), 'UNKNOWN')
})

await test('D2 classifyFailure separates a real fault from every refusal class', async () => {
  const settings = plugin.normalizeConfig({})
  assert.equal(plugin.classifyFailure(llmFailure('MALFORMED_RESPONSE', 'bad json'), settings), 'continue')
  assert.equal(plugin.classifyFailure(llmFailure('EMPTY_RESPONSE', 'nothing'), settings), 'continue')
  assert.equal(plugin.classifyFailure(llmFailure('QUOTA', 'no credit'), settings), 'code:QUOTA')
  assert.equal(plugin.classifyFailure(llmFailure('CONTEXT_WINDOW_EXCEEDED', 'too long'), settings),
    'code:CONTEXT_WINDOW_EXCEEDED')
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  assert.equal(plugin.classifyFailure(abort, settings), 'abort')
})

await test('D3 the continuation text exists in both shipped languages and both carry the guard', async () => {
  const { createNoticeMessage, apply: _apply } = plugin
  assert.equal(typeof createNoticeMessage, 'function')
  for (const language of ['zh', 'en']) {
    const h = createHarness({ language })
    h.endTurn(1, { kind: 'error', error: { code: 'SERVER', message: 'm' } }, llmFailure('SERVER', 'm'))
    await h.clock.fireAll()
    const text = h.followups[0].content[0].text
    assert.ok(
      /先查看当前状态/.test(text) || /inspect the current state/.test(text),
      language + ' prompt must demand a state check first',
    )
    assert.ok(
      /不要盲目重做/.test(text) || /not blindly redo/.test(text),
      language + ' prompt must forbid blind replay',
    )
    h.dispose()
  }
})

console.log('')
console.log('Total: ' + (passed + failed) + '  passed: ' + passed + '  failed: ' + failed)
if (failed > 0) {
  console.log('')
  for (const failure of failures) {
    console.log('FAILED: ' + failure.title)
    if (failure.error && failure.error.stack) console.log(failure.error.stack)
  }
  process.exitCode = 1
} else {
  console.log('All checks passed.')
}
