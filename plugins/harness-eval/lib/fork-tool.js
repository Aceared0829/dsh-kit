/**
 * `harness_fork` — fork this session at a turn boundary, so the same task can be
 * re-run under a different harness.
 *
 * `session.fork` already exists as a Remote method, but nothing exposes it to
 * the model: on this machine 29 sessions already share a parent, and every one
 * of those forks either ran a single turn and stopped or was never started at
 * all. The mechanism was built and never used, because the agent had no way to
 * reach it.
 *
 * What this tool adds beyond the Remote call is the part that makes two runs
 * comparable: it reports what the fork inherited, and it requires the caller to
 * name the ONE thing being changed. A fork that changes two things at once
 * produces two differences and explains neither.
 *
 * The tool writes no session event. This plugin's contract is that mounting it
 * cannot change what any session does, so the fork's own lineage is the record.
 *
 * @module dsh-harness-eval/fork-tool
 */

/**
 * Build a `ToolDefinition` without importing `@deepseek-ai/dsh-tools`.
 *
 * That package is not among this bundle's installed dependencies, and the
 * plugin's existing host half already hand-writes the one artifact it needs from
 * a host package rather than depending on it (see `src/remote-spec.js` and
 * `typert.remote-client.js`). `defineTool` compiles a parameter spec into a JSON
 * Schema and validates arguments against it before `execute`; the registry only
 * consumes the resulting object, so an equivalent object written here is valid
 * input, and this bundle stays installable on its own.
 * @param options - the tool definition in spec form.
 * @returns a registry-ready definition.
 */
function defineTool(options) {
  const parameters = toJsonSchema(options.parameters)
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: { type: 'object' },
      render: () => [{ type: 'text', text: '' }],
    },
    async execute(args, exec) {
      // Validate against THIS tool's own parameter spec, so a second tool
      // registering through the same helper is not forced to satisfy the first
      // tool's required fields.
      const value = coerce(args, options.parameters)
      for (const [name, entry] of Object.entries(options.parameters)) {
        if (entry.required === true && (value[name] === undefined || value[name] === '')) {
          throw new Error(`harness: "${name}" is required for ${options.name} — ${entry.description ?? ''}`.trim())
        }
        if (entry.type === 'integer' && value[name] !== undefined && !Number.isInteger(value[name])) {
          throw new Error(`harness: "${name}" must be an integer for ${options.name}.`)
        }
      }
      return options.execute(value, exec)
    },
    isConcurrencySafe: () => false,
  }
}

/**
 * Keep only the arguments this tool declares, with their declared types.
 * @param args - raw arguments from the model.
 * @param spec - this tool's parameter spec.
 * @returns the declared arguments that were supplied.
 */
function coerce(args, spec) {
  const value = args !== null && typeof args === 'object' ? args : {}
  const out = {}
  for (const [name, entry] of Object.entries(spec)) {
    const given = value[name]
    if (given === undefined) continue
    if (entry.type === 'string' && typeof given === 'string') out[name] = given
    else if (entry.type === 'integer' && typeof given === 'number') out[name] = given
    else if (entry.type !== 'string' && entry.type !== 'integer') out[name] = given
  }
  return out
}

/**
 * Compile the small parameter spec into a JSON Schema.
 * @param spec - parameter specs keyed by name.
 * @returns the JSON Schema the registry publishes to the model.
 */
function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [name, entry] of Object.entries(spec)) {
    properties[name] = {
      type: entry.type,
      ...(entry.description === undefined ? {} : { description: entry.description }),
    }
    if (entry.required === true) required.push(name)
  }
  return { type: 'object', properties, ...(required.length === 0 ? {} : { required }) }
}

import { join } from 'node:path'
import { homedir } from 'node:os'

import { groupsForHome } from './siblings.js'

/** Model-facing guidance, registered as its own prompt section. */
export const PROMPT_TEXT = [
  'To compare harness variants, use harness_fork: it forks this session at a turn boundary into a new session that inherits the earlier turns, and reports what that fork inherited.',
  'Change ONE variable per fork — a skill file, a tool-guidance line, a memory entry — then re-run the same prompt; two simultaneous changes cannot be attributed.',
  'Do not fork just to retry a failure: a fork costs a full re-run of the tail, and a sibling set only answers "which variant was better" when the boundary and the prompt are identical.',
].join(' ')

/**
 * The fork-tool plugin, in the same shape as `./marks-service.js`: a Cordis
 * function plugin that the host entry mounts as a child fiber.
 *
 * The dependencies are declared HERE, on the child, and not on the parent: a
 * child with `inject` waits for its services instead of failing, so the tool
 * activates whenever the profile has a tool registry and a session controller —
 * even when those are registered after this plugin. Checking `ctx.get` in the
 * parent's `apply` was wrong: at that moment the service table is often not
 * populated yet, so the tool silently never mounted.
 * @type {import('@deepseek-ai/cordis').Plugin}
 */
export default {
  name: 'harness-fork',
  inject: ['tools', 'systemPrompt', 'sessionController'],
  apply(ctx) {
    // `getSectionOrder(name)` throws for an order name this build does not
    // declare, and a throw here would abort the whole `apply`: the tool would
    // then never register, with no error a session can see. The prompt section
    // therefore takes a plain numeric order — the same figure that name resolves
    // to — and never asks the registry to validate a name first.
    ctx.systemPrompt.section({
      name: 'tool:harness-fork',
      order: 10,
      text: PROMPT_TEXT,
    })
    ctx.tools.register(defineTool({
      name: 'harness_fork',
      description:
        'Fork this session at a turn boundary into a new session that inherits every completed turn before it, '
        + 'so one task can be re-run under a different harness. Name the one thing you are changing. '
        + 'Returns the new session id, how much was inherited, and the harness the fork starts with.',
      parameters: {
        atTurn: {
          type: 'integer',
          description:
            'Fork after this turn completes, so the new session begins with that turn already done. '
            + 'Omit to use the latest completed turn. Turns are 1-based.',
        },
        change: {
          type: 'string',
          required: true,
          description:
            'The single harness change this fork tests, in one line, such as '
            + '"gui guidance: confirm the window is unchanged before re-capturing". '
            + 'Required, because a fork whose purpose is unrecorded cannot be compared later.',
        },
        note: {
          type: 'string',
          description: 'Optional hypothesis for this fork.',
        },
      },
      execute: (args, exec) => runFork(ctx, args, exec),
    }))
    ctx.tools.register(defineTool({
      name: 'harness_siblings',
      description:
        'List sessions forked from shared parents and say, per group, whether it is a controlled comparison '
        + '(same fork boundary, same task) or why it is not. Read-only. Check this before trusting any A/B '
        + 'result: a group that fails these conditions only looks like an experiment.',
      parameters: {},
      execute: () => listSiblings(),
    }))
  },
}

/**
 * Report the sibling groups in this DSH home.
 *
 * Read-only on purpose: this is the evidence half of S2, so it can be mounted
 * and inspected long before anything writes. Reading the real home rather than
 * injected state is what makes the answer cover sessions this process never
 * opened.
 * @returns the tool result.
 */
function listSiblings() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  let read
  try {
    read = groupsForHome(home)
  } catch (error) {
    return text(`harness_siblings: cannot read sessions under ${home}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (read.groups.length === 0) {
    return text(`harness_siblings: ${read.sessions} session(s) read; no parent has two or more children, so there is no group to compare.`)
  }
  const lines = [`${read.sessions} session(s) read; ${read.groups.length} sibling group(s).`]
  for (const group of read.groups) {
    const forks = group.children.filter(child => child.isFork).length
    lines.push('')
    lines.push(`${group.comparable ? 'COMPARABLE' : 'NOT COMPARABLE'} — parent ${group.parentSession} `
      + `(${group.children.length} children, ${forks} of them forks)`)
    if (group.comparable) lines.push('  inputs matched (same cut, same task)')
    else lines.push(`  because: ${group.reasons.join(', ')}`)
    for (const child of group.children.slice(0, 6)) {
      lines.push(`  ${child.ran ? '' : '(never ran) '}${child.sessionId} `
        + `cut=${child.cut === null ? 'none' : child.cut} turns=${child.turns} calls=${child.calls} `
        + `tokens=${child.inputTokens + child.outputTokens}`)
    }
    if (group.children.length > 6) lines.push(`  … and ${group.children.length - 6} more`)
  }
  return text(lines.join('\n'))
}

/**
 * Run one fork.
 * @param ctx - the plugin context.
 * @param args - tool arguments.
 * @param exec - the execution input carrying the calling agent.
 * @returns the tool result.
 */
async function runFork(ctx, args, exec) {
  const agent = exec?.agent ?? ctx.get('agents')?.currentInitiator()
  if (agent === undefined) {
    return text('harness_fork: no calling session could be resolved.')
  }
  const session = agent.session
  const controller = ctx.get('sessionController')
  if (controller === undefined) {
    return text('harness_fork: the session controller is not mounted in this profile, so no fork is possible.')
  }

  const events = session.events
  const boundaries = turnBoundaries(events)
  if (boundaries.length === 0) {
    return text('harness_fork: this session has no completed turn to fork after.')
  }
  const boundary = args.atTurn === undefined
    ? boundaries.at(-1)
    : boundaries.find(entry => entry.turn === args.atTurn)
  if (boundary === undefined) {
    return text(
      `harness_fork: turn ${String(args.atTurn)} is not a completed turn. `
      + `Available: ${boundaries.map(entry => entry.turn).join(', ')}.`,
    )
  }

  let forked
  try {
    forked = await controller.fork({ sessionId: session.id, atSeq: boundary.seq })
  } catch (error) {
    return text(`harness_fork: forking failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const signature = signatureOf(events)
  const lines = [
    `Forked after turn ${boundary.turn} into ${String(forked.sessionId)}.`,
    `Inherited ${boundary.seq + 1} event(s): every completed turn up to and including turn ${boundary.turn}.`,
    `Change under test: ${args.change}`,
  ]
  if (args.note !== undefined) lines.push(`Hypothesis: ${args.note}`)
  if (signature !== null) {
    lines.push(
      `The fork starts with ${signature.toolCount} tools on ${signature.provider}/${signature.model}`
      + `${signature.reasoningEffort === undefined ? '' : ` (effort ${signature.reasoningEffort})`}.`,
    )
  }
  lines.push(
    'Re-run the same prompt in the fork, then compare tokens, tool calls, repeats and error codes with this session.',
  )
  return text(lines.join('\n'))
}

/**
 * Wrap one message as tool output.
 * @param message - the text.
 * @returns the tool result.
 */
function text(message) {
  return { content: [{ type: 'text', text: message }] }
}

/**
 * Every completed turn, in order, with the seq of its `turn/end`.
 * @param events - the session events.
 * @returns turn number and closing seq.
 */
function turnBoundaries(events) {
  const closed = []
  for (const event of events) {
    if (event.type !== 'turn/end') continue
    const turn = event.data?.turn
    if (typeof turn !== 'number') continue
    // A turn can be re-closed; the first close is the boundary every reader can
    // see, so it is the one a fork can rely on.
    if (closed.some(entry => entry.turn === turn)) continue
    closed.push({ turn, seq: event.seq })
  }
  return closed.sort((left, right) => left.turn - right.turn)
}

/**
 * Read the harness signature from this session's own log.
 * @param events - the session events.
 * @returns the signature, or null when the log has no request header yet.
 */
function signatureOf(events) {
  const header = events.find(event => event.type === 'request/header')
  if (header === undefined) return null
  const config = header.data?.header?.config ?? {}
  const tools = Array.isArray(header.data?.header?.tools) ? header.data.header.tools : []
  return {
    toolCount: tools.length,
    provider: typeof config.provider === 'string' ? config.provider : '',
    model: typeof config.model === 'string' ? config.model : '',
    ...(typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {}),
  }
}
