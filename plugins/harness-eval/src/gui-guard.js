/**
 * S3 candidate 1, in the form that can actually reach the model in time.
 *
 * ## Why this exists
 *
 * The guidance was first written as a skill. A skill is loaded ON DEMAND, so it
 * only reaches a model that already decided to look for it — and repeated
 * observation happens exactly when the model had no idea a rule existed. Writing
 * the rule somewhere the model must choose to read is not a fix for that.
 *
 * The other obvious placements were checked and rejected:
 *
 * - `systemPrompt.context` receives only `{ scope, signal }`, never the session,
 *   so it cannot tell whether THIS session has touched a GUI tool. A static
 *   contribution would sit in every prompt of every session, which is the
 *   opposite of what the token guard wants.
 * - `systemPrompt.tools()` appends schemas; it cannot rewrite the description of
 *   a tool another package registered.
 *
 * What is left is the one moment the model is guaranteed to be looking: the
 * call it is about to make. `tools.guard()` runs before dispatch and its return
 * value is handed to the model as the refusal reason. Returning a reason only
 * for the exact case the guidance is about puts the rule in front of the model
 * at the moment the rule applies, and nowhere else.
 *
 * ## What it does, precisely
 *
 * When a GUI tool is called with arguments IDENTICAL to the immediately previous
 * call, the call is denied with a reason that explains why. The model then has
 * the rule in hand and can decide: if it genuinely needs the capture, it acts on
 * the window first (which changes the arguments or the position) and the next
 * call goes through; if not, it stops paying for the same pixels.
 *
 * Denying rather than warning is deliberate: a warning the model can ignore is
 * the skill problem again. Denial is observable, measurable, and reversible —
 * the model is told exactly what to do instead.
 *
 * @module dsh-harness-eval/gui-guard
 */

/** The tools this guard covers. */
const GUI_PREFIX = 'cua_driver_native__'

/** How many recent calls per session are remembered to detect an immediate repeat. */
const HISTORY = 1

/**
 * The refusal text. It states the rule AND the way forward, because a denial
 * without a next step just makes the model retry differently in the dark.
 * @param tool - the tool that was repeated.
 * @returns the reason handed to the model.
 */
function denyReason(tool) {
  return `You just called ${tool} with exactly these arguments, and nothing acted on the window since. `
    + 'That call returns the same observation you already have — it is not a retry, the result will not change.\n'
    + 'Act on the window first if you need the screen to change (click, type, key, scroll). '
    + 'If you are checking whether your last action worked, use its return value: it already told you. '
    + 'This is not a budget — capture again once something has actually changed.'
}

/**
 * Per-agent memory of the last GUI call.
 *
 * Keyed by the agent object, not by session id: the guard receives the live
 * execution, and a WeakMap releases entries when an agent is disposed rather
 * than leaking across a long-running process.
 */
const lastGuiCall = new WeakMap()

/**
 * @param exec - one tool execution (`ToolExecutionInput`).
 * @returns a stable key for the GUI call, or undefined when the tool is not covered.
 */
function guiCallKey(exec) {
  const name = exec?.name
  if (typeof name !== 'string' || !name.startsWith(GUI_PREFIX)) return undefined
  // Arguments arrive already parsed and guaranteed losslessly JSON-serializable,
  // so serializing them here is stable across two calls with the same intent.
  const args = exec?.arguments
  return `${name}\u0000${typeof args === 'string' ? args : JSON.stringify(args ?? null)}`
}

/**
 * The guard itself.
 * @param exec - the execution about to run.
 * @returns a refusal reason, or undefined to let the call proceed.
 */
function repeatGuard(exec) {
  const key = guiCallKey(exec)
  if (key === undefined) return undefined
  const agent = exec?.agent
  if (agent === undefined) return undefined
  const history = lastGuiCall.get(agent) ?? []
  if (history.length > 0 && history.at(-1) === key) {
    return denyReason(String(exec?.name ?? 'that tool'))
  }
  history.push(key)
  while (history.length > HISTORY) history.shift()
  lastGuiCall.set(agent, history)
  return undefined
}

/**
 * Statistics for the probe: how many denials this process issued.
 */
const denials = { count: 0, tools: {} }

/**
 * @returns a copy of the denial counters.
 */
export function guardStats() {
  return { count: denials.count, tools: { ...denials.tools } }
}

/**
 * The Cordis plugin.
 * @type {import('@deepseek-ai/cordis').Plugin}
 */
export default {
  name: 'harness-gui-guard',
  inject: ['tools'],
  apply(ctx) {
    ctx.tools.guard((exec) => {
      const reason = repeatGuard(exec)
      if (reason !== undefined) {
        denials.count += 1
        const name = String(exec?.name ?? 'unknown')
        denials.tools[name] = (denials.tools[name] ?? 0) + 1
      }
      return reason
    })
  },
}
