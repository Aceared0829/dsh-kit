/**
 * Read-only HTTP endpoints, so the Harness tab can show live figures.
 *
 * ## Why read-only
 *
 * The tab currently renders the projection cache, which only advances when a
 * session commits an event — so it shows minutes-old numbers. These routes read
 * the session logs on demand instead, which is both current and cheap.
 *
 * Only GET. The write path (`--judge`, `--revert`) stays in `loop.mjs` on
 * purpose:
 *
 * - A judge APPLIES or REVERTS a file. Exposing that over HTTP would let anything
 *   that can reach the port change the skills this machine runs with. That needs
 *   a token and an argument, not a convenience flag.
 * - The write path is the part that changes most often. Keeping it in a script
 *   means editing it needs no restart; a route handler is loaded once into the
 *   Host's ESM cache.
 *
 * ## The webServer timing trap
 *
 * `webServer` is provided by the web-app row and may activate AFTER this
 * plugin's `apply`. Reading `ctx.webServer` at apply time can therefore be
 * undefined, and the routes would be silently absent — the same class of failure
 * as a tool that never registers. The registration is retried and, when it never
 * succeeds, reported rather than swallowed.
 *
 * @module dsh-harness-eval/http
 */

import { inForce } from './ledger.js'

/** Route prefix for this plugin. */
const PREFIX = '/api/harness-eval'
/** How long to keep retrying for webServer before giving up. */
const POLL_BUDGET_MS = 20_000
/** Fast polls first (the server is usually ready within a tick), then slow. */
const FAST_TICKS = 20
const FAST_INTERVAL_MS = 100
const SLOW_INTERVAL_MS = 500

/**
 * Send a JSON response.
 * @param res - the server response.
 * @param status - HTTP status.
 * @param body - serializable payload.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // A live reading must never be served from a cache: the whole point is that
  // it reflects the moment it was asked for.
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/**
 * Build the route definitions.
 * @param options - resolved paths and readers.
 * @returns the route list `webServer.register` accepts.
 */
export function routesFor(options) {
  const { ledgerDir, home, measure, rank } = options
  return [
    {
      kind: 'exact',
      path: `${PREFIX}/status`,
      method: 'GET',
      policy: 'open',
      handler: (req, res) => {
        try {
          sendJson(res, 200, { changes: inForce(ledgerDir) })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${PREFIX}/probe`,
      method: 'GET',
      policy: 'open',
      handler: (req, res) => {
        try {
          const measured = measure({ home })
          // The rows are per session and can be large; the tab only needs the
          // summary, and a full dump belongs to the exporter.
          sendJson(res, 200, { sessions: measured.sessions, summary: measured.summary })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${PREFIX}/candidates`,
      method: 'GET',
      policy: 'open',
      handler: (req, res) => {
        try {
          sendJson(res, 200, rank({ home }))
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
}

/**
 * Register the routes against the live webServer.
 *
 * @param ctx - the plugin context.
 * @param options - paths and readers.
 * @param disposers - collected so the plugin's teardown removes the routes.
 * @returns whether registration happened.
 */
export function registerRoutes(ctx, options, disposers) {
  const webServer = ctx.get?.('webServer')
  // Check the METHOD, not just presence. A stub or a partially-constructed
  // service that answers `get` but has no `register` would otherwise throw here,
  // abort this plugin's whole `apply`, and take the evidence tab down with it.
  if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return false
  for (const route of routesFor(options)) {
    disposers.push(webServer.register(route))
  }
  return true
}

/**
 * Retry route registration until webServer appears or the budget runs out.
 *
 * Mirrors what `dsh-graph` does for the same reason, including `unref()` so a
 * pending retry never keeps a short-lived process (a test, a CLI run) alive.
 *
 * @param ctx - the plugin context.
 * @param options - paths and readers.
 * @param disposers - collected disposers.
 * @param report - called once, with the outcome.
 * @returns a cancel function.
 */
export function registerRoutesWhenReady(ctx, options, disposers, report) {
  if (registerRoutes(ctx, options, disposers)) {
    report('now')
    return () => {}
  }
  const started = Date.now()
  let ticks = 0
  let timer
  let settled = false
  const stop = () => {
    settled = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  const poll = () => {
    if (settled) return
    ticks += 1
    if (registerRoutes(ctx, options, disposers)) {
      settled = true
      report(`after ${Date.now() - started} ms`)
      return
    }
    if (Date.now() - started > POLL_BUDGET_MS) {
      // Never silent: a route set that never registered looks exactly like a
      // plugin that works and simply has no endpoints.
      settled = true
      report('failed')
      return
    }
    const delay = ticks < FAST_TICKS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
    timer = setTimeout(poll, delay)
    // Do not hold the process open just to keep polling.
    if (typeof timer.unref === 'function') timer.unref()
  }
  timer = setTimeout(poll, FAST_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  return stop
}

/**
 * The route paths, for the tab and for tests.
 * @returns the three read endpoints.
 */
export function routePaths() {
  return {
    status: `${PREFIX}/status`,
    probe: `${PREFIX}/probe`,
    candidates: `${PREFIX}/candidates`,
  }
}
