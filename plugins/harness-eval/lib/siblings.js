/**
 * Sibling groups: which sessions are actually comparable experiments.
 *
 * A fork inherits a prefix of its parent's log, so a set of forks cut at the
 * same boundary from the same parent ran the same task from the same state. That
 * is the only configuration in which two runs differ *because of* the harness
 * variable someone changed. Everything else is two differences and no
 * attribution.
 *
 * This module reads the logs and decides, per group, whether it is comparable —
 * and when it is not, says which condition failed. On this machine 29 sessions
 * already share a parent, and exactly zero of those groups are comparable: the
 * forks were cut at different boundaries, or cut and never run. A tool that
 * silently averaged them would produce a confident answer from noise.
 *
 * No host dependency: `node:fs` only, so the exporter, the verifier and the
 * plugin all reach the same verdict.
 *
 * @module dsh-harness-eval/siblings
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findSessionLogs, readSessionLog } from './reader.js'
import { hashText } from './evidence.js'

/**
 * Why a group cannot be compared.
 *
 * These are reasons, not scores: a group either supports the claim "the only
 * difference is the harness" or it does not.
 */
export const INCOMPARABLE = {
  /** A child never advanced past the inherited prefix, so it contributed nothing. */
  neverRan: 'neverRan',
  /** No child inherited a prefix, so these are not forks of one boundary at all. */
  notForks: 'notForks',
  /** Children were cut at different boundaries, so they started from different states. */
  differentCut: 'differentCut',
  /** Fewer than two children actually ran, so there is nothing to compare against. */
  onlyOneRan: 'onlyOneRan',
  /** The children did not all receive the same task, so the harness is not the only difference. */
  differentPrompt: 'differentPrompt',
}

/**
 * Read the fork boundary a session inherited.
 *
 * A seeded session records the cut in its own header line (`seedLength`) and
 * repeats it as a `session/end-seed` marker; both are written by the fork that
 * created it. A session with neither started on its own.
 * @param events - decoded events, header first.
 * @returns the inherited event count, or null for an unseeded session.
 */
export function inheritedCut(events) {
  const header = events[0]
  if (header?.isSeeded !== true) return null
  if (typeof header.seedLength === 'number') return header.seedLength
  const marker = events.find(event => event.type === 'session/end-seed')
  return marker === undefined ? null : marker.seq
}

/**
 * Summarize one session for grouping.
 * @param events - decoded events, header first.
 * @returns the fields a grouping decision needs.
 */
export function summarize(events) {
  const header = events[0]
  const turns = events.filter(event => event.type === 'turn/start').length
  const calls = events.filter(event => event.type === 'tool/call').length
  let inputTokens = 0
  let outputTokens = 0
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (usage === null || typeof usage !== 'object') continue
    if (Number.isFinite(usage.inputTokens)) inputTokens += usage.inputTokens
    if (Number.isFinite(usage.outputTokens)) outputTokens += usage.outputTokens
  }
  return {
    sessionId: String(header?.id ?? ''),
    parentSession: header?.parentSession === undefined ? null : String(header.parentSession),
    origin: header?.origin === undefined ? null : String(header.origin),
    createdAt: header?.createdAt ?? 0,
    isSeeded: header?.isSeeded === true,
    cut: inheritedCut(events),
    // How much the child did ON ITS OWN. A fork that never ran has 0 here even
    // though it inherited a long prefix, and averaging it in would look like a
    // cheap run rather than an empty one.
    turns,
    calls,
    inputTokens,
    outputTokens,
    // The session's own prompt, hashed from its first user message: two children
    // told different things are not the same experiment.
    promptHash: promptHashOf(events),
  }
}

/**
 * Hash the first user message, which is the task this session was given.
 *
 * Two forks of the same parent get the same prompt only if the person (or the
 * agent) sent the same thing; a fork where the prompt differed is not a
 * controlled comparison of the harness.
 * @param events - decoded events.
 * @returns an 8-character hash, or null when the session has no user message.
 */
function promptHashOf(events) {
  const message = events.find(event => event.type === 'user/message')
  if (message === undefined) return null
  const content = message.data?.message?.content ?? message.data?.content
  const text = contentText(content)
  return text === '' ? null : hashText(text)
}

/**
 * Flatten message content to text for hashing.
 * @param content - content blocks.
 * @returns the concatenated text.
 */
function contentText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
}

/**
 * Group sessions into comparable experiment sets.
 *
 * A group is one parent plus the children forked from it. Comparability is then
 * decided by the conditions in `INCOMPARABLE`, in the order a reader would
 * check them: did they run, did they start from the same place, is there more
 * than one, and was anything actually varied.
 * @param summaries - per-session summaries.
 * @returns the groups, each with its verdict and the reason it failed.
 */
export function groupSiblings(summaries) {
  const children = new Map()
  for (const summary of summaries) {
    if (summary.parentSession === null) continue
    const list = children.get(summary.parentSession) ?? []
    list.push(summary)
    children.set(summary.parentSession, list)
  }
  const groups = []
  for (const [parentSession, list] of children) {
    if (list.length < 2) continue
    const ran = list.filter(child => child.turns > 0)
    // A child with no inherited prefix is a subagent, not a fork: it shares a
    // parent but started from nothing, so pairing it with a fork compares two
    // different constructs. `null` is its own category, never "all the same".
    const forked = list.filter(child => child.cut !== null)
    const cuts = new Set(forked.map(child => child.cut))
    const prompts = new Set(ran.map(child => child.promptHash))
    const reasons = []
    if (ran.length === 0) reasons.push(INCOMPARABLE.neverRan)
    if (forked.length === 0) reasons.push(INCOMPARABLE.notForks)
    else if (cuts.size > 1) reasons.push(INCOMPARABLE.differentCut)
    if (ran.length < 2) reasons.push(INCOMPARABLE.onlyOneRan)
    if (ran.length >= 2 && prompts.size > 1) reasons.push(INCOMPARABLE.differentPrompt)
    groups.push({
      parentSession,
      children: list.map(child => ({
        sessionId: child.sessionId,
        origin: child.origin,
        cut: child.cut,
        turns: child.turns,
        calls: child.calls,
        inputTokens: child.inputTokens,
        outputTokens: child.outputTokens,
        promptHash: child.promptHash,
        ran: child.turns > 0,
        isFork: child.cut !== null,
      })),
      comparable: reasons.length === 0,
      reasons,
      // A comparable group matched its inputs; whether anything was varied on
      // purpose is a separate question that only S3 (recorded harness changes)
      // can answer. Until then the honest report stops here rather than
      // implying a controlled experiment happened.
      varies: reasons.length === 0 ? 'inputs matched; harness variation not yet recorded' : null,
    })
  }
  groups.sort((left, right) => right.children.length - left.children.length)
  return groups
}

/**
 * Read every session under a DSH home and group its forks.
 * @param dshHome - the DSH home holding `sessions/`.
 * @returns groups plus the per-session count that fed them.
 */
export function groupsForHome(dshHome) {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return { groups: [], sessions: 0 }
  const summaries = []
  for (const found of findSessionLogs(dshHome)) {
    let events
    try {
      events = readSessionLog(found.path)
    } catch {
      continue
    }
    if (events[0]?.type !== 'session') continue
    summaries.push(summarize(events))
  }
  return { groups: groupSiblings(summaries), sessions: summaries.length }
}
