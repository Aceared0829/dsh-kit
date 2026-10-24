/**
 * S3 — the change ledger and its safety rails.
 *
 * S3 is the first stage that writes to the machine: it edits a skill file, then
 * needs to say whether that edit helped. Two properties matter more than the
 * improvement itself.
 *
 * 1. **Every write is reversible and recorded.** A change is applied only after
 *    its before-image is captured, and the ledger entry carries that image. A
 *    revert therefore needs nothing but the ledger, not a re-derived guess at
 *    what the file used to say.
 * 2. **A change is only allowed in the one directory it declares.** The whole
 *    point of restricting S3 to skills is that a mistake costs one prompt and
 *    one write. Letting a path escape that directory would make the restriction
 *    a comment instead of a rule.
 *
 * The ledger is a JSONL file in the workspace, not plugin storage: a person can
 * read it, diff it, and commit it, and it survives the plugin being uninstalled.
 *
 * @module dsh-harness-eval/ledger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

import { hashText } from './evidence.js'

/** Ledger file name inside the ledger directory. */
const LEDGER = 'changes.jsonl'

/**
 * A change the ledger refuses to apply.
 *
 * These are refusals, not warnings: the caller cannot catch-and-continue,
 * because continuing would write outside the declared scope.
 */
export class ScopeError extends Error {
  /**
   * @param message - why the write was refused.
   */
  constructor(message) {
    super(message)
    this.name = 'ScopeError'
  }
}

/**
 * Resolve a path and prove it stays inside an allowed root.
 *
 * Containment is checked on the RESOLVED path with a trailing separator, so a
 * sibling directory sharing a prefix (`skills-evil` next to `skills`) cannot be
 * reached by naming it.
 * @param path - the candidate path.
 * @param roots - directories a write may land in.
 * @returns the absolute path.
 * @throws ScopeError when the path escapes every root.
 */
export function assertInside(path, roots) {
  const target = resolve(path)
  for (const root of roots) {
    const base = resolve(root)
    if (target === base) return target
    if (target.startsWith(base.endsWith(sep) ? base : base + sep)) return target
  }
  throw new ScopeError(`refusing to write ${target}: outside ${roots.map(root => resolve(root)).join(', ')}`)
}

/**
 * Read the current text of a file, or null when it does not exist.
 * @param path - the file.
 * @returns its text, or null.
 */
export function beforeImage(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/**
 * Apply one change and append its ledger entry.
 *
 * The before-image is captured here, inside the same call that writes, so a
 * caller cannot forget it and leave an unrevertable change behind.
 * @param options - see `applyChange`.
 * @returns the ledger entry.
 */
export function applyChange(options) {
  const {
    ledgerDir,
    roots,
    target,
    after,
    hypothesis,
    candidateId,
    metric,
    sessionContext,
  } = options
  const path = assertInside(target, roots)
  if (typeof after !== 'string') throw new ScopeError('a change must supply the full new text')
  const before = beforeImage(path)
  if (before === after) throw new ScopeError(`${path} already holds exactly that text`)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, after, 'utf8')

  const entry = {
    id: `chg-${hashText(`${path}\u0000${Date.now()}\u0000${candidateId ?? ''}`)}`,
    at: new Date().toISOString(),
    candidateId: candidateId ?? null,
    target: path,
    hypothesis: hypothesis ?? '',
    // The metric this change is supposed to move, named before it is measured.
    metric: metric ?? null,
    // Enough context to re-run the same probe later.
    sessionContext: sessionContext ?? null,
    beforeHash: before === null ? null : hashText(before),
    afterHash: hashText(after),
    // The whole previous file: a revert needs no re-derivation.
    before,
    after,
    created: before === null,
    outcome: 'applied',
    revertOf: null,
  }
  appendEntry(ledgerDir, entry)
  return entry
}

/**
 * Restore the before-image of one applied change.
 * @param options - ledger directory, allowed roots, and the change id.
 * @returns the revert ledger entry.
 */
export function revertChange(options) {
  const { ledgerDir, roots, changeId } = options
  const entries = readLedger(ledgerDir)
  const original = entries.find(entry => entry.id === changeId && entry.outcome === 'applied')
  if (original === undefined) throw new ScopeError(`no applied change ${changeId} in the ledger`)

  const path = assertInside(original.target, roots)
  if (original.before === null) {
    // The change created the file, so a revert must leave the tree as it was.
    // Writing an empty file would leave a directory the skill registry still
    // scans, which is a different state from "absent" and can surface as a skill
    // with no instructions.
    removeFileAndEmptyParent(path, roots)
  } else {
    writeFileSync(path, original.before, 'utf8')
  }
  const entry = {
    id: `chg-${hashText(`revert${Date.now()}${changeId}`)}`,
    at: new Date().toISOString(),
    candidateId: original.candidateId,
    target: path,
    hypothesis: `revert ${changeId}`,
    metric: original.metric,
    sessionContext: original.sessionContext,
    beforeHash: original.afterHash,
    afterHash: original.beforeHash,
    before: original.after,
    after: original.before,
    created: false,
    outcome: 'reverted',
    revertOf: changeId,
  }
  appendEntry(ledgerDir, entry)
  return entry
}

/**
 * Remove a created file, and its parent directory when that directory is now
 * empty and is not itself one of the allowed roots.
 *
 * A revert has to restore the state that existed before the change: "the file
 * was not there" and "the file is empty" are different states to anything that
 * scans the tree.
 * @param path - the file the change created.
 * @param roots - allowed roots; none of them may be removed.
 */
function removeFileAndEmptyParent(path, roots) {
  // The file must be GONE, not emptied: an empty SKILL.md is still a skill the
  // registry scans, and it would present as a skill with no instructions.
  if (existsSync(path)) rmSync(path, { force: true })
  const parent = dirname(path)
  const rootSet = new Set(roots.map(root => resolve(root)))
  if (rootSet.has(resolve(parent))) return
  if (!existsSync(parent)) return
  if (readdirSync(parent).length > 0) return
  rmdirSync(parent)
}

/**
 * Record the measurement attached to a change.
 *
 * The verdict is stored next to the change rather than folded into it, so a
 * reading can be recorded before a person decides what it means.
 * @param options - ledger directory, change id, and measured figures.
 * @returns the verdict entry.
 */
export function recordVerdict(options) {
  const { ledgerDir, changeId, before, after, samples, verdict, note } = options
  if (!['kept', 'reverted', 'inconclusive'].includes(verdict)) {
    throw new ScopeError(`unknown verdict ${JSON.stringify(verdict)}`)
  }
  const entry = {
    id: `chg-${hashText(`verdict${Date.now()}${changeId}`)}`,
    at: new Date().toISOString(),
    candidateId: null,
    target: null,
    hypothesis: `verdict for ${changeId}`,
    metric: null,
    sessionContext: null,
    beforeHash: null,
    afterHash: null,
    before: null,
    after: null,
    created: false,
    outcome: 'verdict',
    revertOf: null,
    verdictOf: changeId,
    measurement: { before: before ?? null, after: after ?? null, samples: samples ?? null },
    verdict,
    note: note ?? '',
  }
  appendEntry(ledgerDir, entry)
  return entry
}

/**
 * Append one entry.
 * @param ledgerDir - directory holding the ledger.
 * @param entry - the record.
 */
function appendEntry(ledgerDir, entry) {
  mkdirSync(ledgerDir, { recursive: true })
  appendFileSync(join(ledgerDir, LEDGER), `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * Read the whole ledger.
 * @param ledgerDir - directory holding the ledger.
 * @returns entries in write order; malformed lines are skipped rather than
 *   failing the read, because a torn tail must not hide earlier history.
 */
export function readLedger(ledgerDir) {
  const path = join(ledgerDir, LEDGER)
  if (!existsSync(path)) return []
  const entries = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // A torn last line from an interrupted write.
    }
  }
  return entries
}

/**
 * Summarize the ledger for a person: what is in force right now.
 * @param ledgerDir - directory holding the ledger.
 * @returns the applied changes that have not been reverted, with their verdicts.
 */
export function inForce(ledgerDir) {
  const entries = readLedger(ledgerDir)
  const reverted = new Set(entries.filter(entry => entry.outcome === 'reverted').map(entry => entry.revertOf))
  const verdicts = new Map()
  for (const entry of entries) {
    if (entry.outcome === 'verdict') verdicts.set(entry.verdictOf, entry)
  }
  return entries
    .filter(entry => entry.outcome === 'applied' && !reverted.has(entry.id))
    .map(entry => ({ ...entry, verdict: verdicts.get(entry.id) ?? null }))
}
