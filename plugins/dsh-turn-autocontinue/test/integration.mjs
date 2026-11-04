/**
 * Integration verification for @local/dsh-turn-autocontinue against the REAL harness.
 *
 * Unlike test/verify.mjs (fake context, fake timers, instant), this suite mounts the
 * production plugins from the DSH checkout - LlmRuntime, SessionStore,
 * SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry and the real
 * AgentLoop - and lets a scripted adapter produce the real failure path. The plugin
 * therefore sees genuine `agent/error` events and genuine `turn/end` reasons, and its
 * continuation is delivered through the real Agent.followup()/inbox machinery.
 *
 * It needs the dev junctions in node_modules (see README "Development"): they point at
 * the checkout, so this suite is a developer check, not a shipped runtime dependency.
 *
 * Run: node test/integration.mjs
 */

import assert from 'node:assert/strict'

const cordis = await import('@deepseek-ai/cordis')
const AgentRegistry = (await import('@deepseek-ai/dsh-agent')).default
const AgentLoop = (await import('@deepseek-ai/dsh-agent-loop')).default
const SessionProjectionRegistry = (await import('@deepseek-ai/dsh-session-projection')).default
const dshLlm = await import('@deepseek-ai/dsh-llm')
const SessionStore = (await import('@deepseek-ai/dsh-session')).default
const { SessionId } = await import('@deepseek-ai/dsh-session')
const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).default
const ToolRuntime = (await import('@deepseek-ai/dsh-tools')).default
const NativeToolExecutor = await import('@deepseek-ai/dsh-tool-executor-native')

const plugin = await import('../lib/index.js')

const { Context } = cordis
const { createUserMessage, LlmError } = dshLlm

let passed = 0
let failed = 0
const failures = []
const timeoutMs = 20000

async function test(title, body) {
  try {
    await Promise.race([
      body(),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out after ' + timeoutMs + ' ms')), timeoutMs).unref()
      }),
    ])
    passed += 1
    console.log('  PASS  ' + title)
  } catch (error) {
    failed += 1
    failures.push({ title, error })
    console.log('  FAIL  ' + title)
    console.log('        ' + (error && error.message ? error.message : String(error)))
  }
}

/** A scripted adapter: each model call consumes the next entry. */
class ScriptAdapter extends dshLlm.LlmAdapter {
  constructor(script) {
    super()
    this.script = script
    this.requests = []
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options) {
    this.requests.push(options)
    lastOptions = options
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptAdapter: script exhausted')
    yield* entry
  }
}

/** Chunks for one normal text answer. */
function textResponse(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** An entry that streams one chunk, then waits until the turn is aborted. */
function hangAfterFirstChunk() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      // The real loop wires the turn signal into the options the adapter received;
      // reading it lazily is not possible here, so wait on the shared signal instead.
      await new Promise((_resolve, reject) => {
        const signal = currentSignal()
        if (signal === undefined) { reject(new Error('no signal')); return }
        if (signal.aborted) { reject(new Error('aborted')); return }
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    },
  }
}

/** The adapter's last generate options, used to reach the live turn signal. */
let lastOptions
function currentSignal() {
  return lastOptions?.signal
}

/** An entry that fails the step the way a broken model response does. */
function failing(code, message) {
  return {
    *[Symbol.iterator]() {
      throw new LlmError(message, code)
    },
  }
}

/** Mount the production stack, with the plugin and a scripted adapter. */
async function mount(script, config = {}) {
  // The plugin fiber is returned so a test can unload it mid-backoff.
  const ctx = new Context()
  await ctx.plugin(dshLlm.default)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // Mount the executor module as-is: a wrapper object would drop its `inject` list.
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  // Mount the plugin under test with its own declared inject list and config.
  const pluginDispose = await ctx.plugin({
    name: plugin.name,
    inject: plugin.inject,
    apply: (inner) => plugin.apply(inner, config),
  })
  return { ctx, adapter, pluginDispose }
}

function userSays(text) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Read the plugin's continuation messages back out of a session log. */
function noticesOf(session) {
  return session.snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'turn-autocontinue')
    .map(event => ({ phase: event.data.source.phase, attempt: event.data.source.attempt, text: event.data.content[0].text }))
}

/** The turn/end reasons recorded by a session, in order. */
function turnEnds(session) {
  return session.snapshotEvents()
    .filter(event => event.type === 'turn/end')
    .map(event => event.data.reason)
}

console.log('dsh-turn-autocontinue integration against the real AgentLoop')
console.log('')

await test('I1 a real MALFORMED_RESPONSE turn is continued by the real loop', async () => {
  const { ctx, adapter } = await mount([
    failing('MALFORMED_RESPONSE', 'invalid JSON in ask_user arguments at char 351'),
    textResponse('recovered'),
  ], { backoffMs: [10] })
  const agent = await ctx.agentLoop.create(SessionId('int-1'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await agent.whenIdle()
  // The continuation is scheduled on a real timer after the failure turn settles.
  await agent.whenIdle()
  await new Promise(resolve => setTimeout(resolve, 400))
  await agent.whenIdle()

  const ends = turnEnds(agent.session)
  assert.ok(ends.length >= 1, 'at least one turn ended')
  assert.equal(ends[0].kind, 'error', 'the first turn really failed')
  assert.equal(adapter.requests.length, 2, 'the model was called twice: original + continuation')

  const notices = noticesOf(agent.session)
  assert.equal(notices.length, 1, 'exactly one continuation message was admitted')
  assert.equal(notices[0].phase, 'continue')
  assert.equal(notices[0].attempt, 1)
  assert.match(notices[0].text, /先查看当前状态/)
  assert.match(notices[0].text, /MALFORMED_RESPONSE/)
  await ctx.fiber.dispose?.()
})

await test('I2 the real loop stops after 3 continuations and the stop notice names the count and last cause', async () => {
  const script = []
  for (let index = 0; index < 5; index += 1) {
    script.push(failing('MALFORMED_RESPONSE', 'broken json attempt #' + (index + 1)))
  }
  const { ctx, adapter } = await mount(script, { backoffMs: [10] })
  const agent = await ctx.agentLoop.create(SessionId('int-2'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))

  // Let the whole chain run: each continuation is a fresh turn on a real timer.
  for (let round = 0; round < 12; round += 1) {
    await agent.whenIdle()
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  await agent.whenIdle()

  const notices = noticesOf(agent.session)
  const continues = notices.filter(notice => notice.phase === 'continue')
  const stops = notices.filter(notice => notice.phase === 'stopped')
  assert.equal(continues.length, 3, 'exactly three continuations, never a fourth')
  assert.equal(stops.length, 1, 'exactly one stop notice')
  assert.match(stops[0].text, /已连续自动续跑 3 次/)
  assert.match(stops[0].text, /broken json attempt #4/, 'the stop notice names the last real cause')
  assert.equal(adapter.requests.length, 4, 'four model calls total: original + 3 continuations')
  await ctx.fiber.dispose?.()
})

await test('I3 a real user cancel produces no continuation at all', async () => {
  const { ctx, adapter } = await mount([
    // Stream one chunk, then stay open until the turn's signal is aborted, which is
    // exactly what a user cancel does to a live model stream.
    hangAfterFirstChunk(),
    textResponse('should never be reached'),
  ], { backoffMs: [10] })
  const agent = await ctx.agentLoop.create(SessionId('int-3'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(agent.status, 'running', 'the turn is live when the user cancels')
  agent.cancel({ kind: 'user' })
  await agent.whenIdle()
  await new Promise(resolve => setTimeout(resolve, 400))
  await agent.whenIdle()

  const ends = turnEnds(agent.session)
  const aborted = ends.filter(reason => reason.kind === 'aborted')
  assert.equal(aborted.length, 1, 'the turn really ended aborted')
  assert.equal(noticesOf(agent.session).length, 0, 'a cancelled turn leaves no continuation')
  assert.equal(adapter.requests.length, 1, 'the model was never called again')
  await ctx.fiber.dispose?.()
})

await test('I4 a normal completed turn is never continued', async () => {
  const { ctx, adapter } = await mount([textResponse('done')], { backoffMs: [10] })
  const agent = await ctx.agentLoop.create(SessionId('int-4'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await agent.whenIdle()
  await new Promise(resolve => setTimeout(resolve, 300))
  await agent.whenIdle()

  assert.equal(turnEnds(agent.session).filter(reason => reason.kind === 'completed').length, 1)
  assert.equal(noticesOf(agent.session).length, 0)
  assert.equal(adapter.requests.length, 1)
  await ctx.fiber.dispose?.()
})

await test('I6 the continuation turn is a real turn that can itself complete', async () => {
  const { ctx, adapter } = await mount([
    failing('MALFORMED_RESPONSE', 'broken json'),
    textResponse('recovered and finished'),
  ], { backoffMs: [10] })
  const agent = await ctx.agentLoop.create(SessionId('int-6'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await agent.whenIdle()
  await new Promise(resolve => setTimeout(resolve, 400))
  await agent.whenIdle()

  const ends = turnEnds(agent.session)
  assert.equal(ends[0].kind, 'error', 'turn 1 failed')
  assert.equal(ends[1]?.kind, 'completed', 'the continuation turn completed normally')
  const notices = noticesOf(agent.session)
  assert.equal(notices.length, 1, 'no stop notice after a successful continuation')
  assert.equal(notices[0].phase, 'continue')
  await ctx.fiber.dispose?.()
})

await test('I7 a continuation discarded by a real cancel resets the chain instead of leaking a budget', async () => {
  // The first failure schedules a long backoff continuation. Before it is delivered the
  // user cancels (no live turn, so this only clears the inbox) - then a later failure must
  // still start its own fresh chain.
  const { ctx, adapter } = await mount([
    failing('MALFORMED_RESPONSE', 'broken json'),
    textResponse('not reached in this case'),
  ], { backoffMs: [150] })
  const agent = await ctx.agentLoop.create(SessionId('int-7'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await agent.whenIdle()

  // The race that matters: the user hits Stop at the very moment the continuation is
  // queued. Cancelling from the insertion notifier observes the message in the inbox
  // before the driver claims it, which is exactly the window the plugin must survive.
  const discardedIds = []
  ctx.on('agent/inbox/inserted', ({ message }) => {
    if (message.source.kind !== 'turn-autocontinue') return
    agent.cancel({ kind: 'user' })
  })
  ctx.on('agent/inbox/discarded', ({ message }) => discardedIds.push(message.id))

  await new Promise(resolve => setTimeout(resolve, 400))
  await agent.whenIdle()
  assert.equal(discardedIds.length, 1, 'the queued continuation was really discarded by the real loop')
  assert.equal(adapter.requests.length, 1, 'the discarded continuation never reached the model')
  await ctx.fiber.dispose?.()
})

await test('I5 unloading the plugin cancels a pending continuation', async () => {
  // A long backoff keeps the continuation pending while the plugin is unloaded.
  const { ctx, adapter, pluginDispose } = await mount([
    failing('MALFORMED_RESPONSE', 'broken json'),
    textResponse('must never run'),
  ], { backoffMs: [5000] })
  const agent = await ctx.agentLoop.create(SessionId('int-5'), { provider: 'mock', model: 'mock' })
  agent.followup(userSays('do the task'))
  await agent.whenIdle()
  assert.equal(turnEnds(agent.session).filter(reason => reason.kind === 'error').length, 1)
  assert.equal(adapter.requests.length, 1, 'only the original request ran')

  // Unload the plugin while its 5 s backoff is still pending. ctx.plugin returns a
  // Cordis fiber handle; dispose() unloads exactly that plugin.
  assert.ok(pluginDispose !== undefined && typeof pluginDispose.dispose === 'function',
    'ctx.plugin returned a disposable fiber')
  await pluginDispose.dispose()

  await new Promise(resolve => setTimeout(resolve, 500))
  await agent.whenIdle()
  assert.equal(adapter.requests.length, 1, 'the cancelled timer never delivered a continuation')
  assert.equal(noticesOf(agent.session).length, 0, 'nothing was written after unload')
  await ctx.fiber.dispose?.()
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
  console.log('All integration checks passed.')
}
