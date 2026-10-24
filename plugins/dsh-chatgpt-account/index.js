/** ChatGPT subscription usage for DSH, exposed over a generic Connection RPC channel. */

const RECORD_KEY = 'llm-pi-ai/openai-codex'
const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage'
const DEFAULT_TIMEOUT_MS = 20000

export const inject = []

function endpointOf(config) {
  const raw = (config && config.usageEndpoint) || DEFAULT_ENDPOINT
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('chatgpt-account: bad endpoint')
  }
  return url.href
}

function timeoutOf(config) {
  const value = config && config.timeoutMs
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return DEFAULT_TIMEOUT_MS
}

function accountIdOf(access) {
  const encoded = access.split('.')[1]
  if (encoded === undefined) throw new Error('chatgpt-account: no claims')
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const auth = claims['https://api.openai.com/auth']
  if (!auth || typeof auth.chatgpt_account_id !== 'string') {
    throw new Error('chatgpt-account: no account id')
  }
  return auth.chatgpt_account_id
}

function stateOf(status) {
  return { status: status, email: null, plan: null, quotas: [], credits: null }
}

function windowOf(raw) {
  if (raw === null || raw === undefined) return null
  return {
    usedPercent: typeof raw.used_percent === 'number' ? raw.used_percent : 0,
    windowSeconds: typeof raw.limit_window_seconds === 'number' ? raw.limit_window_seconds : null,
    resetsAt: typeof raw.reset_at === 'number' ? raw.reset_at : null,
  }
}

function quotaOf(name, raw) {
  if (raw === null || raw === undefined) return { name: name, primary: null, secondary: null }
  return { name: name, primary: windowOf(raw.primary_window), secondary: windowOf(raw.secondary_window) }
}

function project(payload) {
  const quotas = [quotaOf('codex', payload.rate_limit), quotaOf('code-review', payload.code_review_rate_limit)]
  const extra = Array.isArray(payload.additional_rate_limits) ? payload.additional_rate_limits : []
  for (const entry of extra) {
    if (entry && typeof entry.limit_name === 'string') quotas.push(quotaOf(entry.limit_name, entry.rate_limit))
  }
  let credits = null
  if (payload.credits && typeof payload.credits.unlimited === 'boolean') {
    const b = payload.credits.balance
    credits = { unlimited: payload.credits.unlimited, balance: (b === null || b === undefined) ? null : String(b) }
  }
  return {
    status: 'ready',
    email: typeof payload.email === 'string' ? payload.email : null,
    plan: typeof payload.plan_type === 'string' ? payload.plan_type : null,
    quotas: quotas.filter(q => q.primary !== null || q.secondary !== null),
    credits: credits,
  }
}

async function readGrant(credentials) {
  const record = await credentials.readRecord(RECORD_KEY)
  if (!record || record.kind !== 'grant') return undefined
  const payload = record.payload
  return (payload && typeof payload.access === 'string') ? payload : undefined
}

async function readAccount(credentials, endpoint, timeoutMs) {
  const grant = await readGrant(credentials)
  if (grant === undefined) return stateOf('signed-out')
  try {
    const headers = { Authorization: 'Bearer ' + grant.access, 'ChatGPT-Account-Id': accountIdOf(grant.access) }
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: headers })
    if (!response.ok) return stateOf('unavailable')
    const body = await response.json()
    const again = await readGrant(credentials)
    if (again === undefined) return stateOf('signed-out')
    if (again.access !== grant.access) return stateOf('unavailable')
    return project(body)
  } catch (error) {
    console.warn('chatgpt-account: query failed (%s)', error instanceof Error ? error.name : 'unknown')
    return stateOf('unavailable')
  }
}

export function apply(ctx, config) {
  const endpoint = endpointOf(config)
  const timeoutMs = timeoutOf(config)
  const connection = ctx.get ? ctx.get('connection') : undefined
  if (!connection || !connection.rpc || typeof connection.rpc.handle !== 'function') {
    console.warn('chatgpt-account: no connection service; channel not installed')
    return
  }
  const credentials = ctx.get ? ctx.get('credentials') : ctx.credentials
  ctx.effect(() => connection.rpc.handle('/dsh-chatgpt', async (method) => {
    try {
      if (method === 'read') return { ok: true, value: await readAccount(credentials, endpoint, timeoutMs) }
      if (method === 'signOut') {
        await credentials.deleteRecord(RECORD_KEY)
        return { ok: true, value: null }
      }
      return { ok: false, error: { code: 'chatgpt/unknown-method', message: method } }
    } catch (error) {
      return { ok: false, error: { code: 'chatgpt/failed', message: error instanceof Error ? error.message : 'failed' } }
    }
  }), 'chatgpt-account: rpc channel')
}
