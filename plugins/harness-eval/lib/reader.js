/**
 * The raw-event reader for harness evidence.
 *
 * `vendor/` holds a verbatim copy of two modules from `@modusensus/dsh-mneme`
 * 0.9.1 (`session-usage.js`, `capabilities.js`). They are vendored rather than
 * depended on because this plugin must keep working when that package is not
 * installed, and they are the only two of its 56 modules that qualify: both
 * import nothing but Node builtins, and `capabilities.js` adds a single
 * sibling import.
 *
 * What they buy is the one thing that is genuinely hard here: decompressing the
 * frame-per-line session log. `zlib.zstdDecompressSync` returns only the FIRST
 * frame of a multi-frame buffer and does not throw, so a naive read silently
 * loses almost the whole file. This module splits on the frame magic first.
 *
 * The host projection never calls this module. The fold runs inside the session
 * process and sees committed events directly; decoding a log from disk is the
 * job of the offline exporter and of `verify.mjs`, which must agree with what
 * the fold produced.
 *
 * @module dsh-harness-eval/reader
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Zstd frame magic. Every appended line starts its own frame. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Names a session log may carry. */
const SESSION_FILE = /^session(\.v\d+)?\.jsonl(\.zstd)?$/

/**
 * Decompress every frame in a buffer.
 *
 * A trailing partial frame is dropped rather than thrown: a session being
 * appended to right now can be read mid-write, and losing the last event is
 * better than failing the whole read.
 * @param buffer - raw file bytes.
 * @returns the concatenated decoded text.
 */
export function decodeFrames(buffer) {
  const starts = []
  for (let at = buffer.indexOf(ZSTD_MAGIC); at >= 0; at = buffer.indexOf(ZSTD_MAGIC, at + 4)) {
    starts.push(at)
  }
  // A plaintext log (compression 'none') carries no frames at all.
  if (starts.length === 0) return buffer.toString('utf8')
  const parts = []
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(starts[index], end)).toString('utf8'))
    } catch {
      // A frame cut short by a concurrent append: skip it and keep the rest.
    }
  }
  return parts.join('')
}

/**
 * Decode one session log into events.
 * @param path - the log file.
 * @returns the parsed events, malformed lines dropped.
 */
export function readSessionLog(path) {
  const text = decodeFrames(readFileSync(path))
  const events = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A torn line at the tail of a live session.
    }
  }
  return events
}

/**
 * Find the newest log for every session under a home's `sessions/` tree.
 *
 * Layout is `sessions/<encoded-cwd>/<session-id>/session[.vN].jsonl[.zstd]`.
 * @param dshHome - the DSH home holding `sessions/`.
 * @returns one `{ sessionId, cwdKey, path }` per session directory.
 */
export function findSessionLogs(dshHome) {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return []
  const found = []
  for (const cwdKey of readdirSync(root)) {
    const workspace = join(root, cwdKey)
    if (!isDirectory(workspace)) continue
    for (const sessionId of readdirSync(workspace)) {
      const directory = join(workspace, sessionId)
      if (!isDirectory(directory)) continue
      const names = readdirSync(directory).filter(name => SESSION_FILE.test(name)).sort()
      const newest = names.at(-1)
      if (newest === undefined) continue
      found.push({ sessionId, cwdKey, path: join(directory, newest) })
    }
  }
  return found
}

/**
 * @param path - candidate path.
 * @returns whether it is a directory.
 */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
