/**
 * Bounded turn-level auto-continuation for DSH.
 *
 * The Harness has no turn-level resume: when a turn ends with `reason.kind === 'error'`
 * the driver simply stops, and the user sees an interruption. This plugin is the fallback
 * net that continues such a turn a small, fixed number of times - on the record - and then
 * stops and says exactly why it stopped.
 *
 * Four invariants (see README.md):
 * 1. Only an abnormal end of the current turn is continued. A turn that ended 'aborted'
 *    (user cancel, parent cancel, disposal, hook denial), an AbortError, and a failure
 *    that another identical turn cannot fix are never continued.
 * 2. At most 3 continuations, spaced by a backoff, each leaving a durable, visible record
 *    of which attempt it is and what the real cause was.
 * 3. The continuation prompt tells the model to inspect the current state first and not
 *    blindly redo the previous command, which may have run half way.
 * 4. At the limit the plugin stops, durably, naming the count and the last real cause.
 *
 * @module @local/dsh-turn-autocontinue
 */

import { randomUUID } from 'node:crypto'

/** Plugin name registered in the Cordis loader. */
export const name = 'turn-autocontinue'

/** The only service this plugin needs: the live agent registry behind session.id. */
export const inject = ['agents']

/** Absolute ceiling on continuations. Config may lower it, never raise it. */
export const HARD_MAX_CONTINUES = 3

/** Durable user/message source kind for everything this plugin writes. */
export const SOURCE_KIND = 'turn-autocontinue'

/**
 * Failure codes that must never be continued, because a further turn cannot succeed:
 * the request was cancelled, the user or a hook refused permission, the route or model is
 * unavailable or unsupported, or a quota/context bound makes every retry identical.
 */
export const NEVER_CONTINUE_CODES = Object.freeze([
  // cancellation, however the harness or the runtime spells it
  'ABORT',
  'ABORTED',
  'ABORT_ERR',
  'CANCELLED',
  'CANCELED',
  'USER_CANCELED',
  'USER_CANCELLED',
  // permission / approval refusals
  'DENIED',
  'PERMISSION_DENIED',
  'APPROVAL_DENIED',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'AUTO_REVIEW_DENIED',
  // the model or route cannot serve this request at all
  'MODEL_DOES_NOT_SUPPORT',
  'MODEL_DOES_NOT_SUPPORT_IMAGES',
  'MODEL_UNAVAILABLE',
  'UNSUPPORTED',
  'UNSUPPORTED_MODEL',
  'NO_ADAPTER',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  // no further turn can fit or pay for the request
  'CONTEXT_WINDOW_EXCEEDED',
  'QUOTA',
  'ACCOUNT_QUOTA',
])

/** Defaults for every tunable value. The profile patch supplies overrides. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Continuations allowed per failure chain; clamped to HARD_MAX_CONTINUES. */
  maxContinues: HARD_MAX_CONTINUES,
  /** Delay before continuation N, indexed by N - 1; the last entry repeats. */
  backoffMs: Object.freeze([2000, 5000, 10000]),
  /** Language of the continuation prompt and of the durable notices. */
  language: 'zh',
  /** Extra failure codes to treat like NEVER_CONTINUE_CODES. */
  neverContinueCodes: Object.freeze([]),
  /** How long to keep checking that the agent is idle before dropping a continuation. */
  idleWaitMs: 3000,
  /** Polling step used while waiting for the agent to become idle. */
  idlePollMs: 100,
})

/**
 * Normalize user configuration onto DEFAULT_CONFIG, clamping the continuation count to
 * the hard ceiling so no patch can turn this plugin into an infinite loop.
 * @param config - raw plugin configuration from the profile patch.
 * @returns a complete, finite configuration.
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const requested = Number.isFinite(raw.maxContinues) ? Math.trunc(raw.maxContinues) : DEFAULT_CONFIG.maxContinues
  const maxContinues = Math.max(0, Math.min(HARD_MAX_CONTINUES, requested))
  const filtered = Array.isArray(raw.backoffMs)
    ? raw.backoffMs.filter(value => Number.isFinite(value) && value >= 0)
    : []
  const backoffMs = filtered.length > 0 ? filtered : [...DEFAULT_CONFIG.backoffMs]
  const extra = Array.isArray(raw.neverContinueCodes)
    ? raw.neverContinueCodes.filter(value => typeof value === 'string').map(value => value.toUpperCase())
    : []
  return {
    maxContinues,
    backoffMs,
    language: raw.language === 'en' ? 'en' : 'zh',
    neverContinueCodes: [...NEVER_CONTINUE_CODES, ...extra],
    idleWaitMs: Number.isFinite(raw.idleWaitMs) && raw.idleWaitMs >= 0 ? raw.idleWaitMs : DEFAULT_CONFIG.idleWaitMs,
    idlePollMs: Number.isFinite(raw.idlePollMs) && raw.idlePollMs > 0 ? raw.idlePollMs : DEFAULT_CONFIG.idlePollMs,
  }
}

/** Read a stable machine code out of a failure of any shape the loop can report. */
export function codeOfFailure(error) {
  if (error === null || typeof error !== 'object') {
    return typeof error === 'string' && error.length > 0 ? error.toUpperCase() : 'UNKNOWN'
  }
  const failure = error.failure
  if (failure !== null && typeof failure === 'object' && typeof failure.code === 'string') {
    return failure.code.toUpperCase()
  }
  if (typeof error.code === 'string' && error.code.length > 0) return error.code.toUpperCase()
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return error.name.toUpperCase()
  return 'UNKNOWN'
}

/** Read a one-line human cause out of a failure of any shape the loop can report. */
export function messageOfFailure(error) {
  if (error === null || typeof error !== 'object') return String(error)
  const failure = error.failure
  if (failure !== null && typeof failure === 'object' && typeof failure.message === 'string') {
    return failure.message
  }
  if (typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/** Whether a failure is an abort in disguise, which is a cancellation and not a fault. */
function looksAborted(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.name === 'AbortError') return true
  const code = codeOfFailure(error)
  return code === 'ABORT_ERR' || code === 'ABORTED' || code === 'ABORT'
}

/**
 * Decide whether one ended turn may be continued.
 * @param error - structured or raw failure observed for the turn.
 * @param settings - normalized configuration.
 * @returns the string 'continue', or the reason this failure is refused.
 */
export function classifyFailure(error, settings = DEFAULT_CONFIG) {
  if (looksAborted(error)) return 'abort'
  const code = codeOfFailure(error)
  const codes = settings.neverContinueCodes ?? NEVER_CONTINUE_CODES
  return codes.includes(code) ? 'code:' + code : 'continue'
}

/** Every user-facing string this plugin writes, in both shipped languages. */
const PROMPTS = {
  zh: {
    continue: (info) => [
      '\u3010\u81ea\u52a8\u7eed\u8dd1 \u7b2c ' + info.attempt + '/' + info.maxContinues + ' \u6b21\u3011',
      '\u4e0a\u4e00\u8f6e\u4e0d\u662f\u6b63\u5e38\u7ed3\u675f\u7684\uff1a\u6a21\u578b\u4fa7\u5f02\u5e38\u628a\u8fd9\u4e00\u8f6e\u6253\u65ad\u4e86\u3002\u771f\u5b9e\u9519\u56e0\uff1a' + info.code + ': ' + info.message + '\u3002',
      '\u8bf7\u7ee7\u7eed\u628a\u539f\u6765\u90a3\u4ef6\u4e8b\u505a\u5b8c\u3002\u52a8\u624b\u4e4b\u524d\u5148\u67e5\u770b\u5f53\u524d\u72b6\u6001\uff1a\u5df2\u7ecf\u5b58\u5728\u54ea\u4e9b\u6587\u4ef6\u3001\u5f53\u524d\u5de5\u4f5c\u76ee\u5f55\u662f\u4ec0\u4e48\u3001\u4e0a\u4e00\u6761\u547d\u4ee4\u662f\u5426\u5df2\u7ecf\u6267\u884c\u8fc7\u4ee5\u53ca\u5b83\u6253\u5370\u4e86\u4ec0\u4e48\u3002',
      '\u4e0d\u8981\u76f2\u76ee\u91cd\u505a\u4e0a\u4e00\u6761\u547d\u4ee4 \u2014\u2014 \u5b83\u53ef\u80fd\u5df2\u7ecf\u8dd1\u4e86\u4e00\u534a\uff08\u5199\u8fc7\u6587\u4ef6\u3001\u8dd1\u8fc7\u8fc1\u79fb\u3001\u542f\u52a8\u8fc7\u540e\u53f0\u4efb\u52a1\uff09\uff0c\u76f2\u76ee\u91cd\u653e\u4f1a\u9020\u6210\u91cd\u590d\u5199\u5165\u6216\u635f\u574f\u3002',
      '\u5982\u679c\u68c0\u67e5\u540e\u53d1\u73b0\u4e8b\u60c5\u5176\u5b9e\u5df2\u7ecf\u5b8c\u6210\uff0c\u6216\u8005\u5df2\u7ecf\u65e0\u6cd5\u7ee7\u7eed\uff0c\u5c31\u76f4\u63a5\u5982\u5b9e\u8bf4\u660e\u73b0\u72b6\uff0c\u4e0d\u8981\u91cd\u590d\u6267\u884c\u3002',
    ].join('\n'),
    stopped: (info) => [
      '\u3010\u81ea\u52a8\u7eed\u8dd1\u5df2\u505c\u6b62\u3011\u5df2\u8fde\u7eed\u81ea\u52a8\u7eed\u8dd1 ' + info.attempts + ' \u6b21\uff0c\u6bcf\u6b21\u90fd\u5931\u8d25\uff0c\u4e0d\u518d\u81ea\u52a8\u91cd\u8bd5\u3002',
      '\u6700\u540e\u4e00\u6b21\u771f\u5b9e\u9519\u56e0\uff1a' + info.code + ': ' + info.message + '\u3002',
      '\u73b0\u5728\u9700\u8981\u4eba\u5de5\u68c0\u67e5\u540e\u624b\u52a8\u7ee7\u7eed\uff1b\u4e0d\u8981\u5047\u8bbe\u4efb\u52a1\u5df2\u7ecf\u5b8c\u6210\u3002',
    ].join('\n'),
    skipped: (info) => '\u3010\u81ea\u52a8\u7eed\u8dd1\u672a\u53d1\u51fa\u3011\u7b2c ' + info.attempt + ' \u6b21\u7eed\u8dd1\u53d6\u6d88\u4e86\uff1a' + info.reason,
    failed: (info) => '\u3010\u81ea\u52a8\u7eed\u8dd1\u672a\u53d1\u51fa\u3011\u7b2c ' + info.attempt + ' \u6b21\u7eed\u8dd1\u65e0\u6cd5\u6295\u9012\uff1a' + info.reason,
  },
  en: {
    continue: (info) => [
      '[auto-continue ' + info.attempt + '/' + info.maxContinues + ']',
      'The previous turn did not end normally: a model-side failure interrupted it. Real cause: ' + info.code + ': ' + info.message + '.',
      'Continue the original task. Before acting, inspect the current state: which files already exist, what the current working directory is, whether the previous command already ran and what it printed.',
      'Do not blindly redo the previous command - it may have run half way (files written, migration applied, background job started), and replaying it can duplicate or corrupt work.',
      'If the inspection shows the work is already done, or cannot be continued, say so plainly instead of repeating it.',
    ].join('\n'),
    stopped: (info) => [
      '[auto-continue stopped] ' + info.attempts + ' automatic continuations all failed; no further attempt will be made.',
      'Last real cause: ' + info.code + ': ' + info.message + '.',
      'A human needs to inspect and resume manually; assume nothing about the task state.',
    ].join('\n'),
    skipped: (info) => '[auto-continue not sent] continuation ' + info.attempt + ' was dropped: ' + info.reason,
    failed: (info) => '[auto-continue not sent] continuation ' + info.attempt + ' could not be delivered: ' + info.reason,
  },
}

/** Build the identified user-role message a user/message event or the inbox carries. */
export function createNoticeMessage(text, extra) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, ...extra },
  }
}

/**
 * Install bounded turn-level auto-continuation.
 * @param ctx - plugin context that owns the listeners and pending timers.
 * @param config - raw configuration from the profile patch.
 * @param internals - optional hooks that make timing deterministic in tests.
 * @returns a disposer that clears listeners, timers and per-session state.
 */
export function apply(ctx, config, internals = {}) {
  const settings = normalizeConfig(config)
  const prompts = PROMPTS[settings.language]
  const schedule = internals.schedule ?? ((run, ms) => setTimeout(run, ms))
  const cancelScheduled = internals.cancelScheduled ?? (handle => clearTimeout(handle))
  const sleep = internals.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const clock = internals.now ?? (() => Date.now())

  // Per-session continuation state, keyed by session id.
  const states = new Map()
  // Timers that are still pending, so disposal can clear every one of them.
  const timers = new Set()
  let disposed = false

  const warn = (text) => {
    try {
      if (ctx.logger !== undefined) ctx.logger.warn(text)
    } catch {
      // Logging is best effort: a logger failure must not break accounting.
    }
  }

  function later(run, ms) {
    const handle = schedule(() => {
      timers.delete(handle)
      if (disposed) return
      run()
    }, ms)
    timers.add(handle)
    return handle
  }

  function stateFor(session, agent) {
    const key = String(session.id)
    let state = states.get(key)
    if (state === undefined) {
      state = {
        key,
        session,
        agent,
        // Continuations already spent in the current failure chain.
        consecutive: 0,
        // Whether this chain owes another turn rather than the human's.
        armed: false,
        // Last failure the driver reported through agent/error.
        pending: undefined,
        // Identity of the continuation message this plugin queued, if any.
        deliveredId: undefined,
      }
      states.set(key, state)
    }
    if (agent !== undefined) state.agent = agent
    if (session !== undefined) state.session = session
    return state
  }

  function resetChain(state) {
    state.consecutive = 0
    state.armed = false
    state.pending = undefined
    state.deliveredId = undefined
  }

  // Append one durable, model-visible notice that never enters the agent inbox.
  function appendNotice(state, text, extra) {
    try {
      state.session.append('user/message', createNoticeMessage(text, extra), { surfaceOp: 'append' })
      return true
    } catch (error) {
      warn('turn-autocontinue: could not record notice for session "' + state.key + '": ' + String(error))
      return false
    }
  }

  // Resolve the live agent for a state, never delivering into a disposed one.
  function liveAgent(state) {
    try {
      const registry = ctx.agents
      if (registry === undefined || typeof registry.get !== 'function') return state.agent
      return registry.get(state.key)
    } catch (error) {
      warn('turn-autocontinue: agent lookup failed for session "' + state.key + '": ' + String(error))
      return undefined
    }
  }

  // Wait, bounded, until the agent has no live turn and no queued input, so a
  // continuation can never interleave with a human turn.
  async function waitUntilIdle(agent) {
    const deadline = clock() + settings.idleWaitMs
    for (;;) {
      if (disposed) return false
      let status
      let pending
      try {
        status = agent.status
        pending = agent.inbox !== undefined && agent.inbox.hasPending === true
      } catch {
        return false
      }
      if (status === 'idle' && !pending) return true
      if (clock() >= deadline) return false
      await sleep(settings.idlePollMs)
    }
  }

  async function deliver(state, attempt, failure) {
    if (disposed) return
    const agent = liveAgent(state)
    if (agent === undefined) {
      // The agent is gone; nothing can be continued and nothing should be recorded.
      state.armed = false
      return
    }
    if (!await waitUntilIdle(agent)) {
      state.armed = false
      const reason = settings.language === 'zh'
        ? '\u4f1a\u8bdd\u91cc\u5df2\u7ecf\u6709\u65b0\u7684\u4e00\u8f6e\u5728\u8fdb\u884c\uff0c\u653e\u5f03\u672c\u6b21\u81ea\u52a8\u7eed\u8dd1'
        : 'a newer turn is already in progress, so this continuation was dropped'
      appendNotice(state, prompts.skipped({ attempt, reason }), {
        phase: 'skipped',
        attempt,
        code: failure.code,
      })
      warn('turn-autocontinue: dropped continuation ' + attempt + ' for session "' + state.key + '": agent not idle')
      return
    }
    const continuation = createNoticeMessage(prompts.continue({
      attempt,
      maxContinues: settings.maxContinues,
      code: failure.code,
      message: failure.message,
    }), {
      phase: 'continue',
      attempt,
      maxContinues: settings.maxContinues,
      code: failure.code,
    })
    try {
      state.deliveredId = continuation.id
      agent.followup(continuation)
    } catch (error) {
      state.armed = false
      state.deliveredId = undefined
      appendNotice(state, prompts.failed({ attempt, reason: String(error) }), {
        phase: 'failed',
        attempt,
        code: failure.code,
      })
      warn('turn-autocontinue: could not deliver continuation ' + attempt + ' for session "' + state.key + '": ' + String(error))
      return
    }
    warn('turn-autocontinue: delivered continuation ' + attempt + '/' + settings.maxContinues
      + ' for session "' + state.key + '" after ' + failure.code)
  }

  // Track whether a queued continuation was actually claimed by a turn, and whether it
  // was discarded before it could run, via the inbox lifecycle the loop publishes.
  function onInboxEvent(state, event) {
    const delivered = state.deliveredId
    if (delivered === undefined) return
    const id = event.type === 'agent/inbox/claimed' || event.type === 'agent/inbox/discarded'
      ? event.message?.id
      : undefined
    if (id !== delivered) return
    if (event.type === 'agent/inbox/claimed') {
      // The owed turn really started; keep tracking the chain.
      state.deliveredId = undefined
      return
    }
    // The continuation was thrown away (a cancel cleared the inbox, or the agent was
    // disposed) so no turn will run it. Drop the whole chain: the next failure starts
    // from a fresh budget rather than inheriting spent attempts.
    resetChain(state)
    warn('turn-autocontinue: continuation was discarded for session "' + state.key
      + '", failure chain reset')
  }

  function onTurnStart(state) {
    // A turn that opens while no continuation is owed was started by a human or by
    // another producer, so the previous failure chain is over and its budget is fresh.
    if (!state.armed) resetChain(state)
  }

  function onTurnEnd(state, turn, reason) {
    const pending = state.pending
    state.pending = undefined
    // The owed turn is over whatever its outcome.
    state.armed = false
    if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') {
      // completed / aborted / blocked / max-tokens / interrupted / forked are never
      // triggers. 'aborted' is the user-cancel path and it resets the chain.
      resetChain(state)
      return
    }
    // Prefer the failure the driver reported for this exact turn; the turn/end payload
    // is already a structured LlmFailure, so it is both the fallback and the cross-check.
    const error = pending !== undefined && pending.turn === turn ? pending.error : reason.error
    const failure = { code: codeOfFailure(error), message: messageOfFailure(error) }
    const verdict = classifyFailure(error, settings)
    if (verdict !== 'continue') {
      resetChain(state)
      warn('turn-autocontinue: refused to continue turn ' + turn + ' of session "' + state.key + '": ' + verdict)
      return
    }
    if (state.consecutive >= settings.maxContinues) {
      const attempts = state.consecutive
      const snapshot = { session: state.session, key: state.key }
      resetChain(state)
      // The notice is deferred: a session/event publication is still open here and
      // Session.append refuses reentrant publication.
      later(() => appendNotice(snapshot, prompts.stopped({
        attempts,
        code: failure.code,
        message: failure.message,
      }), {
        phase: 'stopped',
        attempts,
        code: failure.code,
      }), 0)
      warn('turn-autocontinue: stopped after ' + attempts + ' continuations for session "'
        + state.key + '": ' + failure.code)
      return
    }
    state.consecutive += 1
    state.armed = true
    const attempt = state.consecutive
    const delay = settings.backoffMs[Math.min(attempt - 1, settings.backoffMs.length - 1)]
    later(() => { void deliver(state, attempt, failure) }, delay)
  }

  const offError = ctx.on('agent/error', (payload) => {
    if (disposed) return
    const state = stateFor(payload.agent.session, payload.agent)
    state.pending = { turn: payload.turn, step: payload.step, error: payload.error }
  })

  const offEvent = ctx.on('session/event', (session, event) => {
    if (disposed) return
    const state = states.get(String(session.id))
    if (state === undefined) return
    if (event.type === 'turn/start') onTurnStart(state)
    else if (event.type === 'turn/end') onTurnEnd(state, event.data.turn, event.data.reason)
  })

  // The inbox lifecycle tells this plugin whether its queued continuation was actually
  // claimed by a turn, or discarded before it could run.
  const offClaimed = ctx.on('agent/inbox/claimed', (payload) => {
    if (disposed) return
    const state = states.get(String(payload.agent.session.id))
    if (state !== undefined) onInboxEvent(state, { type: 'agent/inbox/claimed', message: payload.message })
  })

  const offDiscarded = ctx.on('agent/inbox/discarded', (payload) => {
    if (disposed) return
    const state = states.get(String(payload.agent.session.id))
    if (state !== undefined) onInboxEvent(state, { type: 'agent/inbox/discarded', message: payload.message })
  })

  const dispose = () => {
    if (disposed) return
    disposed = true
    try {
      if (typeof offError === 'function') offError()
    } catch {
      // The listener was already unwound by its owning context.
    }
    try {
      if (typeof offEvent === 'function') offEvent()
    } catch {
      // The listener was already unwound by its owning context.
    }
    for (const listener of [offClaimed, offDiscarded]) {
      try {
        if (typeof listener === 'function') listener()
      } catch {
        // The listener was already unwound by its owning context.
      }
    }
    for (const handle of timers) {
      try {
        cancelScheduled(handle)
      } catch {
        // The timer already fired.
      }
    }
    timers.clear()
    for (const state of states.values()) resetChain(state)
    states.clear()
  }

  ctx.effect(() => dispose, 'turn-autocontinue: clear listeners and pending continuations')
  return dispose
}
