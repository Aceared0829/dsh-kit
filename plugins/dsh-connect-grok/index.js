/**
 * Grok (xAI) subscription access for DeepSeek Harness.
 *
 * WHAT THIS PLUGIN DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * DeepSeek Harness already ships everything needed to run Grok models: the
 * `@earendil-works/pi-ai` catalog contains an `xai` provider (protocol
 * `openai-responses`, endpoint `https://api.x.ai/v1`, four Grok models with
 * exact context windows, reasoning ladders and per-token cost), `dsh-llm-pi-ai`
 * serves it as a configurable route, and that same package has already
 * registered an authorization flow for it — a full RFC 8628 device-code login
 * that writes an OAuth grant into the credential store, which pi-ai then
 * refreshes inside a cross-process lock.
 *
 * What the harness is missing is the *surface*: nothing anywhere calls
 * `ctx.authorization.begin()` for `llm-pi-ai/xai`, and the Models page will
 * only ever offer to store an API key for that route. An API key bills the
 * pay-as-you-go API account; it cannot reach a SuperGrok subscription. So the
 * one thing genuinely absent is a button that runs the existing device-code
 * flow, plus a readout of the quota that flow consumes.
 *
 * This plugin is therefore three small pieces, none of which touch the agent
 * loop (DSH keeps its own tools, permissions, compaction and replay):

 *   1. `routes`  — make sure llm-pi-ai's `xai` route is configured, by writing
 *                  the profile its own settings section reads.
 *   2. `login`   — expose `ctx.authorization.begin()` to the card as a
 *                  start/poll pair, because `begin()` resolves only when the
 *                  human finishes in the browser (up to 15 minutes).
 *   3. `quota`   — read the plan, the weekly allowance and the request-level
 *                  rate-limit headers for the card.
 *
 * WHY NOT A CUSTOM ADAPTER
 *
 * Reproducing `PiAiAdapter` + `createProvider` + `openAIResponsesApi` here
 * would re-implement, worse, what the installed adapter already does — and it
 * could not resolve `@earendil-works/pi-ai` anyway: a profile's `node_modules`
 * does not contain it, and no bare-specifier hook exists outside the booted
 * app. Delegating to the shipped route also means the plugin inherits pi-ai's
 * OAuth refresh, its retry policy, its image budgets and its replay
 * validation, instead of duplicating them.
 *
 * @module dsh-connect-grok
 */

/** Credential record the harness's own xAI flow writes. */
const RECORD_KEY = 'llm-pi-ai/xai'

/** Settings entry that owns the pi-ai provider dictionary. */
const LLM_NS = 'llm-pi-ai'

/** Provider route this plugin assumes for Grok. */
const ROUTE = 'xai'

/** Subscription endpoints. See README: these differ from the inference host. */
const BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const USER_URL = 'https://cli-chat-proxy.grok.com/v1/user?include=subscription'

/** Upper bound on any single quota request; the card must not hang on a slow host. */
const QUOTA_TIMEOUT_MS = 15_000

/**
 * A login attempt outlives one HTTP request: the human may take minutes in the
 * browser, while `ctx.authorization.begin()` resolves only at the end. The card
 * therefore polls a slot keyed by this id.
 */
const LOGIN_SLOT_TTL_MS = 20 * 60 * 1000

export const name = 'dsh-connect-grok'

/**
 * Services this plugin requires: none.
 *
 * Every service it reads is resolved through `ctx.get()` at call time, because
 * declaring one makes the entry *wait* for it. A composition that never mounts
 * `logger` would then hold this plugin in `pending (waiting for service:
 * logger)` forever — an entry that never activates, which the staging gate
 * reports as a failure and a user experiences as a plugin that silently does
 * nothing. Diagnostics are not worth that: {@link warnWith} degrades to the
 * console instead.
 */
export const inject = []

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Redact a bearer token to a length-only fingerprint for diagnostics. */
function fingerprint(token) {
  if (typeof token !== 'string' || token.length === 0) return 'empty'
  return token.length + 'c'
}

/**
 * A logger that cannot throw.
 *
 * Cordis resolves services through a proxy that raises
 * `cannot get property "X" without inject` for anything a plugin did not
 * declare — and `logger` is a service like any other. Logging is diagnostics,
 * never behaviour: a composition that does not mount a logger, or refuses the
 * property, must not turn a warning into a plugin that fails to activate. So
 * every call degrades to the console and never propagates.
 * @param ctx - the plugin context.
 * @returns a warn function bound to the context's logger when one is readable.
 */
function warnWith(ctx) {
  return (format, ...args) => {
    try {
      const logger = ctx.logger
      if (logger !== undefined && typeof logger.warn === 'function') {
        logger.warn(format, ...args)
        return
      }
    } catch {
      // Unreadable logger property: fall through to the console.
    }
    try {
      console.warn(format, ...args)
    } catch {
      // Even the console can be absent; a diagnostic is not worth a crash.
    }
  }
}

/**
 * Decode a JWT payload without verifying it.
 *
 * The token is already trusted (it came from this process's own credential
 * store); this exists only to read display facts — the email and the expiry —
 * that the billing endpoint does not return when the grant alone is enough.
 * @param token - a compact JWS.
 * @returns the claim set, or undefined when the token is not a decodable JWT.
 */
function claimsOf(token) {
  if (typeof token !== 'string') return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

/** Whether a grant is close enough to expiry that the harness will refresh on use. */
function expiresAtMsOf(grant) {
  if (typeof grant.expires === 'number' && Number.isFinite(grant.expires)) return grant.expires
  const claims = claimsOf(grant.access)
  if (claims && typeof claims.exp === 'number') return claims.exp * 1000
  return undefined
}

/** One signed-out view; every field the card reads is present and null. */
function signedOut(state) {
  return {
    state,
    email: null,
    plan: null,
    tier: null,
    quota: null,
    limits: null,
    refreshedAt: Date.now(),
  }
}

/**
 * Read the stored xAI grant.
 *
 * The record is written by the harness's own xAI authorization flow, so its
 * shape is pi-ai's OAuth credential stored verbatim under `kind: 'grant'`.
 * @param credentials - the credential service, when one is mounted.
 * @returns the grant payload, or undefined when nothing is stored.
 */
async function readGrant(credentials) {
  if (credentials === undefined) return undefined
  const record = await credentials.readRecord(RECORD_KEY)
  if (record === undefined || record.kind !== 'grant') return undefined
  const payload = record.payload
  if (payload === null || typeof payload !== 'object') return undefined
  if (typeof payload.access !== 'string' || payload.access.length === 0) return undefined
  return payload
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

/** Narrow one `{val}` money/credit cell to a number, or null. */
function valOf(cell) {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'number' && Number.isFinite(cell)) return cell
  if (typeof cell.val === 'number' && Number.isFinite(cell.val)) return cell.val
  return null
}

/**
 * Project the credits-config response into the card's quota block.
 *
 * Field semantics are pinned to `xai-grok-shell/src/extensions/billing.rs`,
 * which documents `creditUsagePercent` as *included credit usage* (0–100,
 * already-used) and prefers `currentPeriod` over the deprecated
 * `billingPeriodStart`/`billingPeriodEnd` pair. Both shapes are accepted here
 * because the endpoint serves the legacy one to older clients.
 * @param payload - the `/v1/billing?format=credits` response body.
 * @returns the quota block, or null when the body carries no usable period.
 */
function quotaOf(payload) {
  const config = payload && typeof payload === 'object' ? payload.config : undefined
  if (config === null || typeof config === 'undefined' || typeof config !== 'object') return null
  const percent = typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent)
    ? config.creditUsagePercent
    : null
  const period = config.currentPeriod && typeof config.currentPeriod === 'object' ? config.currentPeriod : undefined
  const periodType = period && typeof period.type === 'string'
    ? period.type.replace(/^USAGE_PERIOD_TYPE_/, '').toLowerCase()
    : null
  const start = period && typeof period.start === 'string'
    ? period.start
    : (typeof config.billingPeriodStart === 'string' ? config.billingPeriodStart : null)
  const end = period && typeof period.end === 'string'
    ? period.end
    : (typeof config.billingPeriodEnd === 'string' ? config.billingPeriodEnd : null)
  const endMs = end === null ? undefined : Date.parse(end)
  return {
    usedPercent: percent,
    period: periodType,
    periodStart: start,
    periodEnd: end,
    resetsAtMs: Number.isFinite(endMs) ? endMs : null,
    onDemandCap: valOf(config.onDemandCap),
    onDemandUsed: valOf(config.onDemandUsed),
    prepaidBalance: valOf(config.prepaidBalance),
    unified: config.isUnifiedBillingUser === true,
  }
}

/**
 * Fetch one URL with a timeout, returning its JSON body or undefined.
 *
 * Never throws: the card distinguishes "signed in but the quota host is
 * unavailable" from "signed out", and a transport failure must not become a
 * login prompt.
 * @param url - absolute https URL.
 * @param access - bearer access token.
 * @returns the parsed body, or undefined on any failure.
 */
async function fetchJson(url, access) {
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + access, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Merge the two independent reads into one snapshot.
 *
 * Kept separate from {@link readAccount} so the combination rules are testable:
 * the two endpoints fail independently, and each field has a preferred source
 * plus a fallback. In particular the access token's claims do NOT carry an
 * email (the xAI JWT holds `sub`, `scope` and `tier` but no address), so the
 * profile endpoint is the only real source for it.
 * @param parts - the grant, the decoded claims, and both response bodies.
 * @returns the account snapshot.
 */
function snapshotOf(parts) {
  const { grant, claims, billing, user } = parts
  const profile = user !== undefined && user !== null && typeof user === 'object' ? user : undefined

  const email = profile !== undefined && typeof profile.email === 'string'
    ? profile.email
    : (claims !== undefined && typeof claims.email === 'string' ? claims.email : null)

  const base = {
    email,
    plan: profile !== undefined && typeof profile.subscriptionTier === 'string' ? profile.subscriptionTier : null,
    tier: profile !== undefined && typeof profile.hasGrokCodeAccess === 'boolean' ? profile.hasGrokCodeAccess : null,
    quota: billing === undefined ? null : quotaOf(billing),
    limits: null,
    refreshedAt: Date.now(),
    expiresAtMs: expiresAtMsOf(grant) ?? null,
  }

  // Both reads failed: the grant exists but the host is unreachable. Reporting
  // this as `unavailable` — rather than as a sign-out — is what keeps the card
  // from telling a signed-in user to sign in again.
  if (billing === undefined && user === undefined) return { ...base, state: 'unavailable' }
  return { ...base, state: 'ready' }
}

/**
 * Build the account snapshot the card renders.
 *
 * Two independent reads against the subscription host, each allowed to fail
 * on its own: the profile comes from `/v1/user`, the allowance from
 * `/v1/billing`. A 404 here is normal for an account without a coding
 * subscription, so it is reported as an absent value rather than as an error.
 * @param credentials - the credential service.
 * @returns the snapshot; `state` says which branch the card should render.
 */
async function readAccount(credentials) {
  const grant = await readGrant(credentials)
  if (grant === undefined) return signedOut(credentials === undefined ? 'no-vault' : 'signed-out')

  const claims = claimsOf(grant.access)
  const [billing, user] = await Promise.all([
    fetchJson(BILLING_URL, grant.access),
    fetchJson(USER_URL, grant.access),
  ])
  return snapshotOf({ grant, claims, billing, user })
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * One in-flight device-code login.
 * @typedef {object} LoginSlot
 * @property {string} id - opaque handle the card polls with.
 * @property {'pending'|'authorized'|'cancelled'|'failed'} status - terminal once not pending.
 * @property {{message: string, url?: string, code?: string}[]} notices - device-code notices, latest last.
 * @property {string|null} error - human-readable failure, when status is failed.
 * @property {number} startedAt - epoch ms, for TTL reaping.
 */

/**
 * Own the set of in-flight logins.
 *
 * `ctx.authorization.begin()` resolves only when the human finishes, which can
 * be minutes later; a request/response transport cannot hold a call open that
 * long. Each attempt therefore lives in this map and the card polls it, which
 * is the same start/poll shape the WorkBuddy connector uses for its own OAuth.
 * @returns the start, poll and reap operations.
 */
function createLoginRegistry(ctx) {
  /** @type {Map<string, LoginSlot>} */
  const slots = new Map()

  /** Abort every live attempt when the plugin unloads, so no poll loop outlives it. */
  try {
    ctx.effect(() => () => {
      for (const slot of slots.values()) slot.controller.abort()
      slots.clear()
    }, 'dsh-connect-grok: abandon in-flight sign-ins')
  } catch {
    // A composition that refuses effect registration still gets a working
    // registry; the attempts simply are not reaped on unload.
  }

  /** Drop attempts no human could still be completing. */
  function reap(now) {
    for (const [id, slot] of slots) {
      if (now - slot.startedAt <= LOGIN_SLOT_TTL_MS) continue
      slot.controller.abort()
      slots.delete(id)
    }
  }

  /**
   * Start one login and return immediately.
   * @returns the fresh slot, or a failure describing why login cannot run.
   */
  function start() {
    reap(Date.now())
    for (const slot of slots.values()) {
      // One attempt per key is the seam's own rule; surfacing the live slot is
      // friendlier than letting a second `begin()` fail with ALREADY_IN_FLIGHT.
      if (slot.status === 'pending') return { ok: true, slot }
    }
    const authorization = ctx.get('authorization')
    if (authorization === undefined) {
      return {
        ok: false,
        error: {
          code: 'grok/no-authorization',
          message: 'this composition mounts no authorization service; sign-in needs the Web or Desktop profile',
        },
      }
    }
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      return {
        ok: false,
        error: {
          code: 'grok/no-vault',
          message: 'this composition mounts no credentials service, so a sign-in has nowhere to be stored',
        },
      }
    }

    const id = 'login-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    const controller = new AbortController()
    /** @type {LoginSlot & {controller: AbortController}} */
    const slot = { id, status: 'pending', notices: [], error: null, startedAt: Date.now(), controller }
    slots.set(id, slot)

    void authorization.begin({
      key: RECORD_KEY,
      method: 'oauth',
      signal: controller.signal,
      interaction: {
        notify(notice) {
          slot.notices.push({
            message: typeof notice.message === 'string' ? notice.message : '',
            ...notice.url === undefined ? {} : { url: notice.url },
            ...notice.code === undefined ? {} : { code: notice.code },
          })
        },
        // The device-code flow never asks a question: it prints a URL and a
        // code and polls. Declining any prompt that does appear is the correct
        // answer, and matches the one shipped in-tree caller of this seam.
        prompt() {
          return Promise.reject(Object.assign(new Error('the xAI device-code flow asks no questions'), { name: 'AuthorizationDeclinedError' }))
        },
      },
    }).then(
      (outcome) => {
        slot.status = outcome && outcome.status === 'authorized' ? 'authorized' : 'cancelled'
      },
      (error) => {
        slot.status = 'failed'
        slot.error = error instanceof Error ? error.message : String(error)
      },
    )

    return { ok: true, slot }
  }

  /**
   * Read one attempt.
   * @param id - handle returned by {@link start}.
   * @returns the slot, or undefined once reaped.
   */
  function poll(id) {
    reap(Date.now())
    return slots.get(id)
  }

  return { start, poll }
}

// ---------------------------------------------------------------------------
// Route configuration
// ---------------------------------------------------------------------------

/**
 * Ensure llm-pi-ai serves its `xai` route under the profile the plugin intends.
 *
 * The shape written here is the *minimal* one that reaches a subscription:
 *
 *   - no `apiKeyEnv`, because naming a reference makes the adapter fail loud on
 *     a miss and, worse, would make it prefer a stored API key over the OAuth
 *     grant. Omitting it is what hands the request to pi-ai's own auth, which
 *     is where the subscription grant lives.
 *   - no `baseURL`/`api`, because the installed catalog already pins
 *     `https://api.x.ai/v1` and `openai-responses` for every Grok model.
 *
 * The write is a merge (the settings service deep-merges into the live
 * document), so a profile that already customises `xai` keeps its fields.
 * @param ctx - the plugin context.
 * @returns a disposer, or undefined when the settings service is absent.
 */
function ensureRoute(ctx, warn) {
  const settings = ctx.get('settings')
  if (settings === undefined) {
    warn('dsh-connect-grok: no settings service; the xai route must be configured by hand')
    return undefined
  }
  // Fire-and-forget by design: a failure is reported, never thrown, because a
  // misconfigured route must not stop the rest of the plugin from mounting.
  void (async () => {
    try {
      const descriptor = settings.describe().find(row => row.ns === LLM_NS)
      if (descriptor === undefined) {
        warn('dsh-connect-grok: llm-pi-ai is not mounted; Grok models cannot be served')
        return
      }
      // `describe()` yields the live value on the descriptor itself. Reading it
      // as `descriptor.view.value` (a shape the settings *form* uses, not this
      // one) always produced undefined, so the route guard never short-circuited
      // and could not tell an already-configured route from an empty one.
      const current = descriptor.value
      const providers = current !== null && typeof current === 'object' ? current.providers : undefined
      if (providers !== null && typeof providers === 'object' && providers[ROUTE] !== undefined) return
      await settings.update(LLM_NS, { providers: { [ROUTE]: {} } })
    } catch (error) {
      warn(
        'dsh-connect-grok: could not configure the %s route automatically (%s);'
        + ' add `providers: { %s: {} }` to the llm-pi-ai entry of your profile patch',
        ROUTE,
        error instanceof Error ? error.message : String(error),
        ROUTE,
      )
    }
  })()
  return undefined
}

// ---------------------------------------------------------------------------
// Host entry
// ---------------------------------------------------------------------------

/** Base path every card request goes to; one exact route per endpoint. */
const ROUTE_PREFIX = '/plugins/dsh-connect-grok'

/**
 * Endpoints the card may call. Everything else 404s, so the route surface is
 * exactly what this file implements rather than a general dispatcher.
 */
const ENDPOINTS = new Set(['read', 'loginStart', 'loginPoll', 'signOut', 'models', 'setModels'])

/**
 * The reasoning levels each model can declare, and the wire spelling of each.
 *
 * `off` is the interesting one: on every Grok model here it maps to `none`,
 * which tells the endpoint not to reason at all. Leaving `off` out of the dict
 * is what a profile says when it does not want the level offered, so the card
 * exposes it as a checkbox rather than hard-coding either answer.
 */
const GROK_REASONING_WIRE = {
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
}

/**
 * The Grok models this plugin manages, captured from pi-ai's `xai` catalog.
 *
 * Kept here rather than read from pi-ai at runtime because a profile's
 * `node_modules` does not contain `@earendil-works/pi-ai` (only the booted app
 * can resolve it), and because the card is a *manager for Grok only*: it names
 * these four and offers nothing else, which is the whole point of a dedicated
 * section.
 *
 * `maxTokens` is deliberately NOT pi-ai's catalog value. That value is the
 * model's output *capacity* (500000 for the 4.5/4.6/4.7 entries), and DSH
 * treats a model's maxTokens as the tokens one request reserves for output:
 * `compaction-basic` computes `messageBudget = contextWindow - reservedOutput`.
 * Writing 500000 beside a 500000 context window left a message budget of zero,
 * so compaction could never trigger and a long session went to the wire whole
 * — which is exactly the `input_too_large (541418 > 500000)` failure. 64K is a
 * real output allowance (the endpoint accepts up to 128K) that also leaves
 * ~436K of window for messages, so compaction engages around 349K at the
 * default 0.8 threshold, well before the upstream limit.
 */
const GROK_MAX_OUTPUT_TOKENS = 64_000

const GROK_MODELS = [
  { id: 'grok-4.7', name: 'Grok 4.7', contextWindow: 500_000, maxTokens: GROK_MAX_OUTPUT_TOKENS, reasonings: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.6', name: 'Grok 4.6', contextWindow: 500_000, maxTokens: GROK_MAX_OUTPUT_TOKENS, reasonings: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'grok-4.5', name: 'Grok 4.5', contextWindow: 500_000, maxTokens: GROK_MAX_OUTPUT_TOKENS, reasonings: ['low', 'medium', 'high'] },
  { id: 'grok-4.3', name: 'Grok 4.3', contextWindow: 1_000_000, maxTokens: 30_000, reasonings: ['low', 'medium', 'high'] },
]

/** Every Grok model id, for validating a selection the card sends back. */
const GROK_MODEL_IDS = new Set(GROK_MODELS.map(model => model.id))

/** Largest request body accepted; every card request is a small JSON object. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * Whether a request came from this machine's own page.
 *
 * These routes read and clear the user's subscription credential, so they are
 * bound to loopback: a request whose Host or Origin names anything else is
 * refused, which keeps a page from another origin from driving a sign-out.
 * @param req - the incoming request.
 * @returns true when the request may be served.
 */
function isLoopbackRequest(req) {
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string') return false
  const hostname = host.replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1' && hostname !== '[::1]') return false
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
  } catch {
    return false
  }
}

/** Read a bounded JSON request body, or undefined when it is absent/invalid. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return undefined
  }
}

/** Write one JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Read which Grok models the route currently serves, and their reasoning
 * declarations.
 *
 * The answer comes from the live llm-pi-ai profile, not from a private copy:
 * if that entry keeps no `models` list, the route inherits pi-ai's whole Grok
 * catalog, so "everything is enabled" is the honest reading. A narrowed list
 * means the user (or a previous save) turned some off.
 *
 * Reasoning is reported per model as the set of levels that model declares.
 * `null` means the route says nothing for that model, in which case the
 * installed catalog's own ladder applies — the card shows that as "nothing
 * declared" rather than inventing a list.
 * @param ctx - the plugin context.
 * @param warn - the non-throwing logger.
 * @returns the model rows together with the enabled ids.
 */
async function readModelSelection(ctx, warn) {
  let enabled = new Set(GROK_MODEL_IDS)
  /** @type {Map<string, string[] | null>} */
  const declared = new Map()
  try {
    const settings = ctx.get('settings')
    const descriptor = settings === undefined
      ? undefined
      : settings.describe().find(row => row.ns === LLM_NS)
    const providers = descriptor !== undefined && descriptor.value !== null && typeof descriptor.value === 'object'
      ? descriptor.value.providers
      : undefined
    const profile = providers !== null && typeof providers === 'object' ? providers[ROUTE] : undefined
    const listed = profile !== null && typeof profile === 'object' ? profile.models : undefined
    if (Array.isArray(listed)) {
      enabled = new Set(listed.map(entry => entry && entry.id).filter(id => GROK_MODEL_IDS.has(id)))
      for (const entry of listed) {
        if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
        const efforts = entry.reasoningEfforts
        // `false` is a declaration of "no reasoning", which is a different
        // answer from "undeclared" and must survive the round trip.
        if (efforts === false) declared.set(entry.id, [])
        else if (efforts !== null && typeof efforts === 'object') {
          declared.set(entry.id, Object.keys(efforts))
        }
      }
    }
  } catch (error) {
    warn('dsh-connect-grok: could not read the model selection (%s)', error instanceof Error ? error.message : String(error))
  }
  return {
    models: GROK_MODELS.map(model => ({
      ...model,
      enabled: enabled.has(model.id),
      // null = the route declares nothing for this model.
      declaredEfforts: declared.has(model.id) ? declared.get(model.id) : null,
    })),
    enabledModelIds: GROK_MODELS.filter(model => enabled.has(model.id)).map(model => model.id),
  }
}

/**
 * Persist which Grok models the route serves, and which reasoning levels each
 * one declares.
 *
 * Written as an explicit `models` list so the selection is the route's whole
 * catalog: an entry per enabled model, with the capacity and reasoning ladder
 * this plugin knows. `reasoningEfforts` is what the Models page's "模型能力" card
 * would otherwise write; owning it here means the Grok section is the one place
 * those levels are decided.
 *
 * A model whose declared levels equal its full catalog ladder writes no
 * `reasoningEfforts` at all: that is the same request, and leaving it out keeps
 * the profile readable and lets a future catalog change take effect.
 * @param ctx - the plugin context.
 * @param ids - enabled Grok model ids, already validated.
 * @param effortsById - optional per-model level lists; a missing entry means
 *   "leave the catalog ladder in place".
 * @param warn - the non-throwing logger.
 */
async function writeModelSelection(ctx, ids, effortsById, warn) {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('no settings service is mounted')
  const chosen = GROK_MODELS.filter(model => ids.includes(model.id))
  await settings.update(LLM_NS, {
    providers: {
      [ROUTE]: {
        models: chosen.map(model => {
          const entry = {
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
          }
          const requested = effortsById !== undefined && Object.hasOwn(effortsById, model.id)
            ? effortsById[model.id]
            : undefined
          if (!Array.isArray(requested)) return entry
          // Only levels this model actually offers, in a stable order. `off` is
          // not in `model.reasonings` (that list is the thinking ladder), so it
          // is admitted separately — dropping it would silently turn "don't
          // think" back into the model's default.
          const offered = ['off', ...model.reasonings]
          const levels = offered.filter(level => requested.includes(level))
          if (levels.length === 0) return { ...entry, reasoningEfforts: false }
          const wire = {}
          for (const level of levels) wire[level] = GROK_REASONING_WIRE[level] ?? level
          // Selecting the model's entire ladder (without `off`) is the same
          // request as declaring nothing, so leave the profile quiet.
          if (levels.length === model.reasonings.length && !requested.includes('off')) {
            return entry
          }
          return { ...entry, reasoningEfforts: wire }
        }),
      },
    },
  })
}

/**
 * Mount the plugin.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  const warn = warnWith(ctx)

  // Nothing in this entry may throw: a bundle that fails to activate takes the
  // whole profile's remaining entries down with it, which is a far worse
  // outcome than a card that renders "unavailable".
  try {
    const logins = createLoginRegistry(ctx)
    ensureRoute(ctx, warn)

    // The card talks over a plain HTTP route, not an RPC channel: `ctx.connection`
    // is a Host-side service with no client counterpart in a settings page, so a
    // page asking for it gets nothing. Web routes are the transport both shipped
    // connectors use, and the browser carries its own cookie.
    const runEndpoint = async (endpoint, payload) => {
      const credentials = ctx.get('credentials')
      switch (endpoint) {
        case 'read':
          return { ok: true, value: await readAccount(credentials) }
        case 'loginStart': {
          const started = logins.start()
          if (!started.ok) return started
          return {
            ok: true,
            value: { loginId: started.slot.id, notices: started.slot.notices },
          }
        }
        case 'loginPoll': {
          const id = payload && typeof payload === 'object' ? payload.loginId : undefined
          const slot = typeof id === 'string' ? logins.poll(id) : undefined
          if (slot === undefined) {
            return {
              ok: true,
              value: { status: 'expired', notices: [], error: 'this sign-in attempt is no longer tracked' },
            }
          }
          return {
            ok: true,
            value: { status: slot.status, notices: slot.notices, error: slot.error, loginId: slot.id },
          }
        }
        case 'signOut':
          if (credentials === undefined) {
            return { ok: false, error: { code: 'grok/no-vault', message: 'no credential service is mounted' } }
          }
          await credentials.deleteRecord(RECORD_KEY)
          return { ok: true, value: null }
        case 'models':
          return { ok: true, value: await readModelSelection(ctx, warn) }
        case 'setModels': {
          const ids = payload && typeof payload === 'object' ? payload.enabledModelIds : undefined
          if (!Array.isArray(ids)) {
            return { ok: false, error: { code: 'grok/bad-request', message: 'enabledModelIds must be an array' } }
          }
          const unknown = ids.filter(id => typeof id !== 'string' || !GROK_MODEL_IDS.has(id))
          if (unknown.length > 0) {
            return {
              ok: false,
              error: { code: 'grok/unknown-model', message: 'not a Grok model: ' + unknown.join(', ') },
            }
          }
          const efforts = payload && typeof payload === 'object' ? payload.reasoningEffortsByModel : undefined
          if (efforts !== undefined && (efforts === null || typeof efforts !== 'object' || Array.isArray(efforts))) {
            return {
              ok: false,
              error: { code: 'grok/bad-request', message: 'reasoningEffortsByModel must be an object' },
            }
          }
          // Refuse a level the model does not offer rather than silently
          // dropping it: a checkbox that saves nothing is worse than an error.
          if (efforts !== undefined) {
            for (const [id, levels] of Object.entries(efforts)) {
              if (!GROK_MODEL_IDS.has(id)) {
                return { ok: false, error: { code: 'grok/unknown-model', message: 'not a Grok model: ' + id } }
              }
              if (!Array.isArray(levels)) {
                return { ok: false, error: { code: 'grok/bad-request', message: 'levels for ' + id + ' must be an array' } }
              }
              const model = GROK_MODELS.find(entry => entry.id === id)
              const bad = levels.filter(level => level !== 'off' && !model.reasonings.includes(level))
              if (bad.length > 0) {
                return {
                  ok: false,
                  error: { code: 'grok/unknown-level', message: model.id + ' has no level ' + bad.join(', ') },
                }
              }
            }
          }
          await writeModelSelection(ctx, ids, efforts, warn)
          return { ok: true, value: await readModelSelection(ctx, warn) }
        }
        default:
          return { ok: false, error: { code: 'grok/unknown-method', message: String(endpoint) } }
      }
    }

    // `webServer` may mount after this plugin, so it is waited for rather than
    // probed once: a single `ctx.get()` here silently loses every route on
    // Desktop, where the server comes up later than the settings bundles.
    // The dependency argument is a record, not an array — an array is rejected
    // by the loader and the callback never runs, which is how the routes
    // silently failed to register.
    ctx.inject({ webServer: true }, (serverCtx) => {
      for (const endpoint of ENDPOINTS) {
        serverCtx.effect(() => serverCtx.webServer.register({
          kind: 'exact',
          path: ROUTE_PREFIX + '/' + endpoint,
          handler: async (req, res) => {
            if (!isLoopbackRequest(req)) {
              sendJson(res, 403, { ok: false, error: { code: 'grok/forbidden', message: 'loopback only' } })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: { code: 'grok/method', message: 'POST only' } })
              return
            }
            const payload = await readJsonBody(req)
            if (payload === undefined) {
              sendJson(res, 400, { ok: false, error: { code: 'grok/bad-request', message: 'invalid JSON body' } })
              return
            }
            try {
              sendJson(res, 200, await runEndpoint(endpoint, payload))
            } catch (error) {
              warn('dsh-connect-grok: %s failed: %s', endpoint, error instanceof Error ? error.message : String(error))
              sendJson(res, 200, {
                ok: false,
                error: { code: 'grok/failed', message: error instanceof Error ? error.message : 'failed' },
              })
            }
          },
        }), 'dsh-connect-grok: ' + endpoint + ' route')
      }
    })
  } catch (error) {
    warn('dsh-connect-grok: mount failed: %s', error instanceof Error ? error.message : String(error))
  }
}

/** Exported for tests: the projection helpers are pure. */
export { quotaOf, claimsOf, fingerprint, snapshotOf }
