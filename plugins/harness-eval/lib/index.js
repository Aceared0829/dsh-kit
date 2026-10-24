/**
 * Host half of dsh-harness-eval.
 *
 * Contributes the `harnessEvidence` projection unit, which folds already-logged
 * session events into per-session evidence, and mounts the `harnessMarks`
 * service, which owns the durable mark records the browser half writes through
 * the Remote boundary.
 *
 * Neither writes a session event nor reaches a model request, so mounting this
 * plugin cannot change what any session does.
 *
 * The fold itself lives in `evidence.js` so the offline exporter and the
 * verification script compute exactly the same numbers from a decoded log.
 *
 * @module dsh-harness-eval
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import HarnessMarks from './marks-service.js'
import { registerRoutesWhenReady, routePaths } from './http.js'
import { rankCandidates } from './candidates.js'
import { findSessionLogs, readSessionLog } from './reader.js'
import HarnessFork from './fork-tool.js'
import GuiGuard from './gui-guard.js'
import { EVIDENCE_VERSION, emptyState, fold, isBreakdown } from './evidence.js'

/**
 * Where the change ledger lives.
 *
 * In the workspace, not in plugin storage: a person reads it, diffs it and
 * commits it, and it survives this plugin being uninstalled. `HARNESS_LEDGER`
 * overrides it; otherwise it sits under the current working directory, so a
 * checkout anywhere works without editing this file.
 */
const LEDGER_DIR = process.env.HARNESS_LEDGER
  ?? join(process.cwd(), 'reports', 'harness-eval-ledger')

/**
 * The DSH home holding session logs.
 *
 * `DSH_HOME` when the Host was launched with one, otherwise the default Desktop
 * development home, which is where this build keeps its sessions.
 * @returns the directory to read logs from.
 */
function resolveDshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Measure the same figures the CLI probe reports, for the HTTP route.
 *
 * This duplicates `s3/probe.mjs`'s arithmetic on purpose but keeps its
 * DEFINITION identical: metric is the count of GUI calls that were a re-issue,
 * cost is input tokens, exposure is how many sessions touched a GUI tool at all.
 * A route that measured differently from the probe would let the tab and the
 * CLI disagree about the same number, which is worse than the duplication.
 *
 * Kept tiny and dependency-free because it runs inside the Host.
 * @param options - `{ home }`.
 * @returns the summary the route serves.
 */
function measureEvidence(options = {}) {
  const home = options.home ?? resolveDshHome()
  const GUI_PREFIX = 'cua_driver_native__'
  let sessions = 0
  let sessionsWithGui = 0
  let guiCalls = 0
  let guiRepeats = 0
  let guardDenials = 0
  let inputTokens = 0
  for (const found of findSessionLogs(home)) {
    let events
    try {
      events = readSessionLog(found.path)
    } catch {
      continue
    }
    const header = events[0]
    if (header?.type !== 'session') continue
    if (!events.some(event => event.type === 'turn/start')) continue
    sessions += 1
    const counts = new Map()
    let touchedGui = false
    for (const event of events) {
      if (event.type === 'tool/result') {
        const message = event.data?.message
        if (message?.isError === true) {
          const parts = Array.isArray(message.content) ? message.content : []
          if (parts.some(part => typeof part?.text === 'string'
            && part.text.includes('with exactly these arguments, and nothing acted on the window since'))) {
            guardDenials += 1
          }
        }
        continue
      }
      if (event.type === 'assistant/message') {
        const usage = event.data?.usage
        if (usage !== null && typeof usage === 'object' && Number.isFinite(usage.inputTokens)) {
          inputTokens += usage.inputTokens
        }
        continue
      }
      if (event.type !== 'tool/call') continue
      if (!String(event.data?.name ?? '').startsWith(GUI_PREFIX)) continue
      touchedGui = true
      const key = `${event.data.name}\u0000${event.data.arguments ?? ''}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (touchedGui) sessionsWithGui += 1
    for (const count of counts.values()) {
      guiCalls += count
      if (count > 1) guiRepeats += count - 1
    }
  }
  return {
    sessions,
    metric: guiRepeats,
    cost: inputTokens,
    exposure: sessionsWithGui,
    guardDenials,
    summary: {
      sessions,
      sessionsWithGui,
      guiCalls,
      guiRepeats,
      guiRepeatShare: guiCalls === 0 ? null : Math.round((guiRepeats / guiCalls) * 100),
      guardDenials,
      inputTokens,
    },
  }
}

/** Cordis plugin name. */export const name = 'harness-eval'
/**
 * Only the projection registry is required. The fork tool's services are
 * resolved with `ctx.get` inside `apply` instead of being injected: an
 * `inject.optional` entry still makes Cordis hold the whole plugin until that
 * service appears, which would take the evidence tab down in a profile that has
 * no tool registry.
 */
export const inject = ['sessionProjections']

/**
 * Read the marks of one session from the live service.
 *
 * Assigned when the plugin mounts and cleared when its fiber unloads. It must
 * never throw: it runs inside `wire.view`, where an exception fails the whole
 * session projection and leaves the session unreadable. A service that is not
 * mounted, a domain that failed to open, or a malformed record therefore all
 * read as "no marks".
 */
let marksReader

/**
 * Collect one session's marks, containing every failure.
 *
 * `wire.view` is called by the projection registry for every session, so an
 * exception here is not contained to this plugin — it breaks session loading.
 * The read therefore cannot be allowed to throw.
 * @param sessionId - session whose marks are wanted.
 * @returns the marks, or an empty list when any part of the read fails.
 */
function readMarks(sessionId) {
  if (marksReader === undefined || typeof sessionId !== 'string' || sessionId === '') return []
  try {
    return marksReader(sessionId)
  } catch (error) {
    console.warn('[harness-eval] could not read marks for this session:', error)
    return []
  }
}

/**
 * State → wire view.
 * @param state - folded state.
 * @param marks - marks recorded for this session, already in creation order.
 * @returns the value the browser half renders.
 */
function view(state, marks = []) {
  const turns = state.turns.map(turn => ({
    turn: turn.turn,
    seq: turn.seq,
    steps: turn.steps,
    toolCalls: turn.toolCalls,
    toolErrors: turn.toolErrors,
    usage: {
      input: turn.usage.inputTokens,
      output: turn.usage.outputTokens,
      cacheRead: turn.usage.cacheReadTokens,
    },
    // An open turn has no outcome yet, so omit the key rather than
    // serializing `undefined`.
    ...(turn.outcome === null ? {} : { outcome: turn.outcome }),
    ...(turn.retries === 0 ? {} : { retries: turn.retries }),
  }))
  // Only a real breakdown is a fork point. A turn the person interrupted is not
  // a failure of the run, and treating it as one inflated every fork estimate
  // this plugin produced before version 5.
  const firstBreakdown = state.turns.find(turn => turn.outcome !== null && isBreakdown(turn.outcome))
  // Spinning: the trailing run of closed turns that neither called a tool nor
  // ended cleanly. A completed turn, or one with work in it, stops the count.
  let idle = 0
  for (let index = state.turns.length - 1; index >= 0; index -= 1) {
    const turn = state.turns[index]
    if (turn.outcome === null) break
    if (turn.toolCalls > 0 || turn.outcome === 'completed') break
    idle += 1
  }
  // Re-running only the tail is the whole economic premise of a contrast loop:
  // it costs this much instead of the whole run. Reported in tokens as well as
  // steps, because tokens are what a re-run actually costs.
  const bifurcateAt = firstBreakdown === undefined ? null : firstBreakdown.turn
  let tailSteps = 0
  let tailToolCalls = 0
  let tailInput = 0
  let tailOutput = 0
  if (bifurcateAt !== null) {
    for (const turn of state.turns) {
      if (turn.turn < bifurcateAt) continue
      tailSteps += turn.steps
      tailToolCalls += turn.toolCalls
      tailInput += turn.usage.inputTokens
      tailOutput += turn.usage.outputTokens
    }
  }
  const harness = {
    ...(state.harness.cwd === undefined ? {} : { cwd: state.harness.cwd }),
    ...(state.harness.agentPreset === undefined ? {} : { agentPreset: state.harness.agentPreset }),
    ...(state.harness.parentSession === undefined ? {} : { parentSession: state.harness.parentSession }),
    createdAt: state.harness.createdAt,
  }
  const share = (part, whole) => (whole === 0 ? null : Math.round((part / whole) * 100))
  const totalTokens = state.usage.inputTokens + state.usage.outputTokens
  const tailTokens = tailInput + tailOutput
  return {
    harness,
    ...(state.harnessSignature === null ? {} : { signature: state.harnessSignature }),
    totals: {
      turns: state.turns.length,
      steps: state.totalSteps,
      toolCalls: state.totalToolCalls,
      toolErrors: state.totalToolErrors,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      cacheReadTokens: state.usage.cacheReadTokens,
      messages: state.usage.messages,
    },
    turns,
    ...(firstBreakdown === undefined ? {} : { firstIncompleteTurn: firstBreakdown.turn }),
    idleTurns: idle,
    // Repeat accounting: `repeats` counts re-issues, never the first call.
    repeats: state.repeats,
    // Which tools repeated, so the number has a name attached to it.
    ...(state.topRepeats === undefined || state.topRepeats.length === 0
      ? {}
      : { topRepeats: state.topRepeats }),
    // `bifurcateAt` is null (not absent) so the client can distinguish "no
    // break to fork from" from "the host has not published the field".
    bifurcate: {
      turn: bifurcateAt,
      tailSteps,
      tailToolCalls,
      tailInputTokens: tailInput,
      tailOutputTokens: tailOutput,
      // Rounded share of the run a tail re-run would reach; omitted as null
      // when the session did no steps, because 0/0 has no meaning.
      tailShare: share(tailSteps, state.totalSteps),
      tailTokenShare: share(tailTokens, totalTokens),
    },
    // Kept apart so an evaluation cannot mistake a transport hiccup for an
    // agent mistake.
    retries: state.retries.count,
    retryCodes: state.retries.codes,
    errorCodes: state.errorCodes,
    // Denials issued by this plugin's own repeat guard, counted apart from
    // agent mistakes. A number this plugin caused must never be read as the
    // model's fault when judging a run.
    guardDenials: state.errorCodes['guard/repeated-observation'] ?? 0,
    // Marks are a person's observations about this session's turns, carried as
    // whole records so the view needs no second read.
    marks: marks.map(mark => ({
      id: mark.id,
      turn: mark.turn,
      kind: mark.kind,
      reason: mark.reason,
      createdAt: mark.createdAt,
    })),
  }
}

/** The `harnessEvidence` unit registered on `ctx.sessionProjections`. */
const harnessEvidenceProjectionDefinition = {
  key: 'harnessEvidence',
  // Bumped for the S1 evidence shape: token accounting, retry separation,
  // error codes, repeat fingerprints, harness signature, and the fork point
  // narrowed to real breakdowns. A cached row from an earlier version must be
  // discarded and refolded, not served as current.
  stateVersion: EVIDENCE_VERSION,
  // No schema library in this package: the fold only writes the fields this
  // definition names and `view` reads nothing else, so no row `fold` produces
  // can fail a stricter schema. Cold restores re-fold the log rather than
  // trusting stored state.
  stateSchema: { parse: value => value },
  init: header => ({
    ...emptyState(),
    // The view needs the session id to look up its marks, and `wire.view`
    // receives no header.
    sessionId: header.id,
    harness: {
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
      ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
      createdAt: header.createdAt,
    },
  }),
  apply: fold,
  wire: {
    viewSchema: { parse: value => value },
    // The registry passes only the state. Marks live in the marks service, so
    // the view reads them through the guarded reader; a newly written mark
    // surfaces on the next projection change.
    view: state => view(state, readMarks(state.sessionId)),
  },
}

/**
 * The unit definition, exported so the exporter and the tests can fold a log
 * exactly the way the host does.
 */
export const projection = harnessEvidenceProjectionDefinition

/**
 * Mount the evidence half, and the fork tool when the profile can run it.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx) {
  ctx.sessionProjections.register(harnessEvidenceProjectionDefinition)
  // The child fiber waits for the service's own `storageDomain` injection.
  // The projection may run before that fiber activates, so the reader resolves
  // the service dynamically on every call.
  ctx.plugin(HarnessMarks)
  // `ctx.harnessMarks` requires declaring `harnessMarks` in `inject`; reading it
  // through the property proxy throws from this plugin's fiber. `ctx.get`
  // performs the topology-independent lookup and reports absence as undefined.
  marksReader = sessionId => ctx.get('harnessMarks')?.marksFor(sessionId) ?? []
  ctx.effect(() => () => { marksReader = undefined }, 'harness-eval: marks reader')

  // Read-only HTTP routes, so the tab can show figures taken now instead of the
  // projection cache's last checkpoint. Registration is retried because
  // `webServer` may activate after this `apply`, and the outcome is reported
  // rather than swallowed — a route set that never registered is otherwise
  // indistinguishable from a plugin that simply has no endpoints.
  const routeDisposers = []
  const cancelRoutePolling = registerRoutesWhenReady(
    ctx,
    { ledgerDir: LEDGER_DIR, home: resolveDshHome(), measure: measureEvidence, rank: rankCandidates },
    routeDisposers,
    outcome => {
      if (outcome === 'failed') {
        console.warn(`[harness-eval] ${routePaths().status} and its siblings never registered: webServer did not appear`)
      }
    },
  )
  ctx.effect(() => () => {
    cancelRoutePolling()
    for (const dispose of routeDisposers) dispose()
    routeDisposers.length = 0
  }, 'harness-eval: http routes')

  // The fork tool is mounted unconditionally. Its own `inject` makes the child
  // fiber WAIT for a tool registry and a session controller, so a profile
  // without them simply never activates the child, while the evidence tab —
  // which needs only the projection registry — still works. Deciding here with
  // `ctx.get` was wrong: the service table is often not populated yet when this
  // plugin's `apply` runs, so the tool silently never mounted.
  ctx.plugin(HarnessFork)

  // S3 candidate 1: deny an immediately repeated GUI observation, so the rule
  // arrives with the call it is about instead of waiting to be looked up.
  ctx.plugin(GuiGuard)
}
