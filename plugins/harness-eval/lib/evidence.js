/**
 * The evidence fold, shared by the live projection and the offline exporter.
 *
 * One implementation means one definition of every number. The projection unit
 * in `index.js` runs this over committed events as a session grows; `export.mjs`
 * and `verify.mjs` run it over a decoded log. If the two disagreed, every
 * evaluation built on them would be measuring the disagreement.
 *
 * Design rules that come from the two failures this package already survived:
 *
 *   - The state is persisted by the projection cache, so it must survive a
 *     lossless JSON round trip: no `undefined`, and no `Map`/`Set`/class
 *     instance anywhere in it. Absent optional values are OMITTED KEYS.
 *   - Nothing here throws on a malformed event. A single odd event must not
 *     fail the projection for the whole session.
 *
 * @module dsh-harness-eval/evidence
 */

/** Bumped whenever the shape this module produces changes. */
export const EVIDENCE_VERSION = 5

/**
 * Turn outcomes. `interrupted` and `aborted` are the PERSON stopping the run,
 * not the agent failing: they stay distinct so an evaluation cannot count them
 * as breakdowns.
 */
const OUTCOMES = {
  completed: 'completed',
  error: 'failed',
  aborted: 'aborted',
  interrupted: 'interrupted',
  'max-tokens': 'truncated',
}

/**
 * Map a `turn/end` reason to its outcome.
 * @param reason - the recorded reason.
 * @returns the outcome vocabulary member.
 */
export function outcomeOf(reason) {
  return OUTCOMES[reason?.kind] ?? 'other'
}

/**
 * Whether an outcome is the agent breaking down, as opposed to a person
 * stopping the run. Only these count as a break to fork from.
 * @param outcome - an outcome vocabulary member.
 * @returns true when the agent failed on its own.
 */
export function isBreakdown(outcome) {
  return outcome === 'failed' || outcome === 'truncated' || outcome === 'other'
}

/** A fresh per-turn record. */
function newTurn(turn, seq) {
  return {
    turn,
    seq,
    // `null` means the turn is still open; the wire view omits `outcome`.
    outcome: null,
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    retries: 0,
  }
}

/** An empty state, as `init` builds it. */
export function emptyState() {
  return {
    sessionId: '',
    harness: { createdAt: 0 },
    turns: [],
    closedTurns: 0,
    totalSteps: 0,
    totalToolCalls: 0,
    totalToolErrors: 0,
    // Token accounting. `totalTokens` is deliberately NOT summed: on real data
    // it disagrees with `input + output` on 1187 of 1193 messages, which reads
    // as a running total; summing it multiplies the true figure.
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, messages: 0 },
    // Infrastructure retries, kept apart from tool errors: a transport hiccup
    // says nothing about the agent's competence.
    retries: { count: 0, codes: {} },
    // Agent mistakes, by the machine code a tool reported.
    errorCodes: {},
    // Identical `{name, arguments}` repeats: the "experience did not
    // accumulate" signal. This is the same call re-issued within one session.
    repeats: 0,
    // Per-key counts backing `repeats`, keyed by a hash of name + arguments. A
    // plain object, not a Map, so the state stays JSON. Bounded: new keys are
    // ignored past the cap, which can only under-count an extremely diverse
    // session, never corrupt it.
    repeatCounts: {},
    // The most-repeated tools, by name and count, for the panel to name them.
    topRepeats: [],
    // What the harness was, so two runs can be compared at all.
    harnessSignature: null,
  }
}

/** How many named repeats the view carries. */
const TOP_REPEATS = 5

/**
 * How many distinct call keys are tracked before the map is pruned back.
 *
 * The projection cache persists this state on every change, so the map cannot
 * grow with the session: a long session issuing thousands of distinct calls
 * would turn each row write into an ever-larger object. Pruning drops the rarest
 * keys first, which only under-counts repeats — it never invents one.
 */
const REPEAT_KEY_CAP = 512

/**
 * Fold one event.
 * @param state - previous state.
 * @param event - the committed session event.
 * @returns the next state, or the same reference when nothing changed.
 */
export function fold(state, event) {
  switch (event.type) {
    case 'turn/start': return onTurnStart(state, event)
    case 'turn/end': return onTurnEnd(state, event)
    case 'step/start': return onStepStart(state, event)
    case 'tool/call': return onToolCall(state, event)
    case 'tool/result': return onToolResult(state, event)
    case 'assistant/message': return onAssistantMessage(state, event)
    case 'llm/retry': return onLlmRetry(state, event)
    case 'request/header': return onRequestHeader(state, event)
    case 'system/message': return onSystemMessage(state, event)
    default: return state
  }
}

/**
 * @param state - previous state.
 * @param event - a `turn/start`.
 * @returns next state.
 */
function onTurnStart(state, event) {
  const last = state.turns.at(-1)
  // A boundary that does not advance the turn number is a retried opener; the
  // standing row keeps the first seq.
  if (last !== undefined && event.data.turn <= last.turn) return state
  return { ...state, turns: [...state.turns, newTurn(event.data.turn, event.seq)] }
}

/**
 * @param state - previous state.
 * @param event - a `turn/end`.
 * @returns next state.
 */
function onTurnEnd(state, event) {
  const last = state.turns.at(-1)
  if (last === undefined || last.outcome !== null) return state
  return {
    ...state,
    closedTurns: state.closedTurns + 1,
    turns: replaceLast(state.turns, { ...last, outcome: outcomeOf(event.data.reason) }),
  }
}

/**
 * @param state - previous state.
 * @param event - a `step/start`.
 * @returns next state.
 */
function onStepStart(state) {
  const last = state.turns.at(-1)
  if (last === undefined) return state
  return {
    ...state,
    totalSteps: state.totalSteps + 1,
    turns: replaceLast(state.turns, { ...last, steps: last.steps + 1 }),
  }
}

/**
 * Count a call and notice whether the exact same call already happened.
 * @param state - previous state.
 * @param event - a `tool/call`.
 * @returns next state.
 */
function onToolCall(state, event) {
  const last = state.turns.at(-1)
  if (last === undefined) return state
  // Name plus raw arguments: two calls differing only in whitespace are the
  // same intent, two differing in a path are not.
  const raw = `${event.data.name}\u0000${event.data.arguments ?? ''}`
  // The persisted state keeps a HASH of the call, not the call. Storing the raw
  // arguments made a single session's row 470 KB, because a long session issues
  // hundreds of distinct calls each carrying a full tool payload. The hash is
  // the same length for every call, so the row stays bounded.
  const key = hashText(raw)
  const tracked = Object.hasOwn(state.repeatCounts, key)
  // A key first seen while the map is full is counted this one time but never
  // stored, so it can never be reported as a repeat. Under-counting is the safe
  // direction; inventing a repeat from a distinct call would not be. A hash
  // collision would over-count, so the map is kept far below any birthday risk.
  if (!tracked && Object.keys(state.repeatCounts).length >= REPEAT_KEY_CAP) {
    return {
      ...state,
      totalToolCalls: state.totalToolCalls + 1,
      turns: replaceLast(state.turns, { ...last, toolCalls: last.toolCalls + 1 }),
      repeatCounts: pruneRepeats(state.repeatCounts),
    }
  }
  const count = (state.repeatCounts[key] ?? 0) + 1
  const repeated = count > 1
  const next = {
    ...state,
    totalToolCalls: state.totalToolCalls + 1,
    turns: replaceLast(state.turns, { ...last, toolCalls: last.toolCalls + 1 }),
    repeatCounts: { ...state.repeatCounts, [key]: count },
    repeats: repeated ? state.repeats + 1 : state.repeats,
  }
  // Name the worst offenders for the panel; only the name and count are kept.
  if (repeated) next.topRepeats = bumpTopRepeat(state.topRepeats, String(event.data.name ?? ''), count)
  return next
}

/**
 * Keep the display list of repeated calls bounded.
 * @param list - current list, already in descending count order.
 * @param name - tool name.
 * @param count - the new count for this key.
 * @returns the next list.
 */
function bumpTopRepeat(list, name, count) {
  const next = [...(list ?? [])]
  const at = next.findIndex(entry => entry.name === name)
  if (at >= 0) next[at] = { name, count }
  else next.push({ name, count })
  next.sort((left, right) => right.count - left.count)
  return next.slice(0, TOP_REPEATS)
}

/**
 * Drop the rarest half of the tracked keys so the map stops growing.
 * @param counts - current per-key counts.
 * @returns a smaller map carrying the same shape.
 */
function pruneRepeats(counts) {
  const kept = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, REPEAT_KEY_CAP >> 1)
  return Object.fromEntries(kept)
}

/**
 * Text a guard writes when it DENIES a call.
 *
 * A tool guard's refusal is recorded as an ordinary tool error with no `code`,
 * so without this marker a denial this plugin caused would be counted as an
 * agent mistake — the evaluation would blame the model for a number the plugin
 * chose. The marker is matched on a stable phrase the guard always emits.
 */
const GUARD_DENIAL_MARKER = 'with exactly these arguments, and nothing acted on the window since'

/**
 * Whether a tool error is this plugin's own guard firing.
 * @param message - the tool result message.
 * @returns true when the failure came from the repeat guard.
 */
function isGuardDenial(message) {
  const content = message?.content
  if (!Array.isArray(content)) return false
  for (const part of content) {
    if (typeof part?.text === 'string' && part.text.includes(GUARD_DENIAL_MARKER)) return true
  }
  return false
}

/**
 * @param state - previous state.
 * @param event - a `tool/result`.
 * @returns next state.
 */
function onToolResult(state, event) {
  // `isError` is the model-facing failure bit; a successful message must not
  // count even when the tool returned an error-shaped payload.
  if (event.data.message?.isError !== true) return state
  const last = state.turns.at(-1)
  if (last === undefined) return state
  // A denial this plugin issued is not an agent mistake, so it gets its own
  // bucket instead of landing in the error histogram next to real failures.
  const guarded = isGuardDenial(event.data.message)
  const code = guarded
    ? 'guard/repeated-observation'
    : typeof event.data.error?.code === 'string' ? event.data.error.code : 'uncoded'
  return {
    ...state,
    totalToolErrors: state.totalToolErrors + 1,
    turns: replaceLast(state.turns, { ...last, toolErrors: last.toolErrors + 1 }),
    errorCodes: { ...state.errorCodes, [code]: (state.errorCodes[code] ?? 0) + 1 },
  }
}

/**
 * Accumulate token usage, session-wide and per turn.
 *
 * Only `inputTokens`, `outputTokens` and `cacheReadTokens` are summed; see the
 * note in `emptyState`.
 * @param state - previous state.
 * @param event - an `assistant/message`.
 * @returns next state.
 */
function onAssistantMessage(state, event) {
  const usage = event.data.usage
  if (usage === null || typeof usage !== 'object') return state
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const last = state.turns.at(-1)
  return {
    ...state,
    usage: {
      inputTokens: state.usage.inputTokens + input,
      outputTokens: state.usage.outputTokens + output,
      cacheReadTokens: state.usage.cacheReadTokens + cacheRead,
      messages: state.usage.messages + 1,
    },
    ...(last === undefined ? {} : {
      turns: replaceLast(state.turns, {
        ...last,
        usage: {
          inputTokens: last.usage.inputTokens + input,
          outputTokens: last.usage.outputTokens + output,
          cacheReadTokens: last.usage.cacheReadTokens + cacheRead,
        },
      }),
    }),
  }
}

/**
 * Record one infrastructure retry.
 * @param state - previous state.
 * @param event - an `llm/retry`.
 * @returns next state.
 */
function onLlmRetry(state, event) {
  const code = typeof event.data.failure?.code === 'string' ? event.data.failure.code : 'uncoded'
  const last = state.turns.at(-1)
  return {
    ...state,
    retries: {
      count: state.retries.count + 1,
      codes: { ...state.retries.codes, [code]: (state.retries.codes[code] ?? 0) + 1 },
    },
    ...(last === undefined ? {} : {
      turns: replaceLast(state.turns, { ...last, retries: last.retries + 1 }),
    }),
  }
}

/**
 * Capture which tools the harness offered, from the first request that carries
 * them. Without this two runs cannot be compared: on real data a single
 * `agentPreset` value spans 36 distinct tool sets.
 * @param state - previous state.
 * @param event - a `request/header`.
 * @returns next state.
 */
function onRequestHeader(state, event) {
  if (state.harnessSignature !== null && state.harnessSignature.toolCount > 0) return state
  const header = event.data.header ?? {}
  const tools = Array.isArray(header.tools) ? header.tools : []
  const config = header.config ?? {}
  const previous = state.harnessSignature ?? emptySignature()
  return {
    ...state,
    harnessSignature: {
      ...previous,
      toolCount: tools.length,
      toolsHash: hashList(tools.map(tool => String(tool?.name ?? ''))),
      provider: typeof config.provider === 'string' ? config.provider : previous.provider,
      model: typeof config.model === 'string' ? config.model : previous.model,
      ...(typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {}),
    },
  }
}

/**
 * Capture the system prompt size from the first system message.
 * @param state - previous state.
 * @param event - a `system/message`.
 * @returns next state.
 */
function onSystemMessage(state, event) {
  const content = event.data.message?.content
  if (!Array.isArray(content)) return state
  const text = content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
  if (text === '') return state
  if (state.harnessSignature !== null && state.harnessSignature.promptChars > 0) return state
  return {
    ...state,
    harnessSignature: {
      ...(state.harnessSignature ?? emptySignature()),
      promptChars: text.length,
      promptHash: hashText(text),
    },
  }
}

/** A signature with every field present, so later patches are simple spreads. */
function emptySignature() {
  return { toolCount: 0, toolsHash: '', promptChars: 0, promptHash: '', provider: '', model: '' }
}

/**
 * Coerce a token field.
 * @param value - raw value.
 * @returns a non-negative integer.
 */
function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** Replace the last row, keeping every earlier row's identity. */
function replaceLast(rows, next) {
  return [...rows.slice(0, -1), next]
}

/**
 * A small, order-independent hash of a string list.
 * @param values - the list.
 * @returns a 32-bit hex digest.
 */
export function hashList(values) {
  return hashText([...values].sort().join('\u0001'))
}

/**
 * FNV-1a over a string.
 * @param text - input text.
 * @returns a 32-bit hex digest.
 */
export function hashText(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
