/**
 * "It must open without error" — the mount contract.
 *
 * A bundle that throws during activation takes every remaining entry of the
 * profile down with it, so the Host half is held to a strict rule: `apply()`
 * never throws, whatever the composition gives it.
 *
 * The transport is a set of exact web routes, registered through
 * `ctx.inject(['webServer'], ...)` so a server that mounts later (as on Desktop)
 * still gets them. These tests drive the registered handler directly.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject } from '../index.js'

/** Minimal request stand-in: async-iterable body plus headers. */
function fakeReq(options = {}) {
  const { body = '', headers = { host: '127.0.0.1:1' }, method = 'POST' } = options
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body.length > 0) yield Buffer.from(body, 'utf8')
    },
  }
}

/** Response stand-in capturing status and JSON body. */
function fakeRes() {
  const res = {
    status: undefined,
    headers: undefined,
    body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers; return res },
    end(chunk) { if (chunk !== undefined) res.body = String(chunk); return res },
  }
  return res
}

function throwingProxy(base) {
  return {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'symbol') return undefined
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  }
}

/**
 * A context that refuses exactly like Cordis does for an undeclared service,
 * and that hands the `webServer` service to `inject` callbacks.
 * @returns the context plus the captured routes.
 */
function fakeCtx(options = {}) {
  const { services = {}, loggerThrows = false, effectThrows = false } = options
  const routes = new Map()
  const base = {
    get(name) { return services[name] },
    effect(factory) {
      if (effectThrows) throw new Error('effect refused')
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    // `ctx.inject(deps, cb)` takes a record of required services, not an array.
    inject(deps, callback) {
      const names = Array.isArray(deps) ? deps : Object.keys(deps)
      const childServices = { ...services }
      if (names.includes('webServer') && childServices.webServer === undefined) {
        childServices.webServer = {
          register(route) { routes.set(route.path, route); return () => {} },
        }
      }
      const childBase = {
        webServer: childServices.webServer,
        get(name) { return childServices[name] },
        effect(factory) { const d = factory(); return typeof d === 'function' ? d : () => {} },
        inject() { return () => {} },
        logger: undefined,
      }
      callback(new Proxy(childBase, throwingProxy(childBase)))
      return () => {}
    },
    logger: undefined,
  }
  if (loggerThrows) {
    Object.defineProperty(base, 'logger', {
      get() { throw new Error('cannot get property "logger" without inject') },
    })
  }
  return { ctx: new Proxy(base, throwingProxy(base)), routes }
}

/** Invoke one captured route with the given request. */
async function hit(routes, endpoint, reqOptions) {
  const route = routes.get('/plugins/dsh-connect-grok/' + endpoint)
  assert.ok(route, `route ${endpoint} must be registered`)
  const res = fakeRes()
  await route.handler(fakeReq(reqOptions), res)
  return { status: res.status, body: res.body.length > 0 ? JSON.parse(res.body) : undefined }
}

test('inject stays empty so the entry never waits for a service', () => {
  // Declaring `logger` once made this plugin sit in
  // `pending (waiting for service: logger)` in a composition that never mounts
  // one — an entry that never activates.
  assert.deepEqual(inject, [])
})

test('mounts on an empty context without throwing', () => {
  const { ctx } = fakeCtx()
  assert.doesNotThrow(() => apply(ctx))
})

test('mounts when the logger property itself throws', () => {
  const { ctx } = fakeCtx({ loggerThrows: true })
  assert.doesNotThrow(() => apply(ctx))
})

test('mounts when effect registration is refused', () => {
  const { ctx } = fakeCtx({ effectThrows: true })
  assert.doesNotThrow(() => apply(ctx))
})

test('registers one exact route per endpoint', () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  assert.deepEqual([...routes.keys()].sort(), [
    '/plugins/dsh-connect-grok/loginPoll',
    '/plugins/dsh-connect-grok/loginStart',
    '/plugins/dsh-connect-grok/models',
    '/plugins/dsh-connect-grok/read',
    '/plugins/dsh-connect-grok/setModels',
    '/plugins/dsh-connect-grok/signOut',
  ])
  for (const route of routes.values()) assert.equal(route.kind, 'exact')
})

test('models lists the four Grok models and nothing else', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status, body } = await hit(routes, 'models', { body: '{}' })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  const ids = body.value.models.map(m => m.id)
  assert.deepEqual(ids, ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3'])
  // A subsection of its own: no other vendor may appear here.
  for (const id of ids) assert.match(id, /^grok-/)
})

test('models reports every model enabled when the route keeps no list', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'models', { body: '{}' })
  assert.deepEqual(body.value.enabledModelIds, ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3'])
})

test('models reflects a narrowed route list', async () => {
  const { ctx, routes } = fakeCtx({
    services: {
      settings: {
        describe: () => [{
          ns: 'llm-pi-ai',
          value: { providers: { xai: { models: [{ id: 'grok-4.7' }, { id: 'grok-4.5' }] } } },
        }],
        update: async () => {},
      },
    },
  })
  apply(ctx)
  const { body } = await hit(routes, 'models', { body: '{}' })
  assert.deepEqual(body.value.enabledModelIds, ['grok-4.7', 'grok-4.5'])
  assert.equal(body.value.models.find(m => m.id === 'grok-4.6').enabled, false)
})

test('setModels writes the selection as the route catalog', async () => {
  const writes = []
  const { ctx, routes } = fakeCtx({
    services: {
      settings: {
        describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }],
        update: async (ns, patch) => { writes.push({ ns, patch }) },
      },
    },
  })
  apply(ctx)
  const { body } = await hit(routes, 'setModels', { body: JSON.stringify({ enabledModelIds: ['grok-4.7'] }) })
  assert.equal(body.ok, true)
  // `ensureRoute` may also write once at mount; the last write is the save.
  const saved = writes[writes.length - 1]
  assert.equal(saved.ns, 'llm-pi-ai')
  const models = saved.patch.providers.xai.models
  assert.deepEqual(models.map(m => m.id), ['grok-4.7'])
  // Capacities travel with the entry: the route must not re-guess them.
  assert.equal(models[0].contextWindow, 500000)
  // The output reservation must leave room for messages. A maxTokens equal to
  // the context window zeroed `messageBudget = contextWindow - reservedOutput`,
  // so compaction could never fire and a long session went to the wire whole —
  // the `input_too_large (541418 > 500000)` failure.
  assert.ok(models[0].maxTokens < models[0].contextWindow / 2,
    'maxTokens must leave the majority of the window for messages')
})

test('setModels refuses a model it does not manage', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'setModels', { body: JSON.stringify({ enabledModelIds: ['gpt-5'] }) })
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/unknown-model')
})

test('setModels refuses a non-array payload', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'setModels', { body: JSON.stringify({ enabledModelIds: 'grok-4.7' }) })
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/bad-request')
})

test('setModels writes reasoningEfforts for the levels the card picked', async () => {
  const writes = []
  const { ctx, routes } = fakeCtx({
    services: {
      settings: {
        describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }],
        update: async (ns, patch) => { writes.push(patch) },
      },
    },
  })
  apply(ctx)
  const { body } = await hit(routes, 'setModels', {
    body: JSON.stringify({
      enabledModelIds: ['grok-4.7'],
      reasoningEffortsByModel: { 'grok-4.7': ['off', 'low', 'high'] },
    }),
  })
  assert.equal(body.ok, true)
  const entry = writes[writes.length - 1].providers.xai.models[0]
  // `off` travels as the wire value the endpoint understands.
  assert.deepEqual(entry.reasoningEfforts, { off: 'none', low: 'low', high: 'high' })
})

test('a model keeping its whole ladder writes no reasoningEfforts', async () => {
  const writes = []
  const { ctx, routes } = fakeCtx({
    services: {
      settings: {
        describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }],
        update: async (ns, patch) => { writes.push(patch) },
      },
    },
  })
  apply(ctx)
  await hit(routes, 'setModels', {
    body: JSON.stringify({
      enabledModelIds: ['grok-4.5'],
      reasoningEffortsByModel: { 'grok-4.5': ['low', 'medium', 'high'] },
    }),
  })
  const entry = writes[writes.length - 1].providers.xai.models[0]
  assert.equal(entry.reasoningEfforts, undefined, 'an undeclared ladder keeps the catalog answer')
})

test('setModels refuses a reasoning level the model does not offer', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'setModels', {
    body: JSON.stringify({
      enabledModelIds: ['grok-4.5'],
      reasoningEffortsByModel: { 'grok-4.5': ['xhigh'] },
    }),
  })
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/unknown-level')
})

test('models reports the declared ladder, or null when undeclared', async () => {
  const { ctx, routes } = fakeCtx({
    services: {
      settings: {
        describe: () => [{
          ns: 'llm-pi-ai',
          value: {
            providers: {
              xai: {
                models: [
                  { id: 'grok-4.7', reasoningEfforts: { low: 'low', high: 'high' } },
                  { id: 'grok-4.6' },
                ],
              },
            },
          },
        }],
        update: async () => {},
      },
    },
  })
  apply(ctx)
  const { body } = await hit(routes, 'models', { body: '{}' })
  assert.deepEqual(body.value.models.find(m => m.id === 'grok-4.7').declaredEfforts, ['low', 'high'])
  assert.equal(body.value.models.find(m => m.id === 'grok-4.6').declaredEfforts, null)
})

test('every managed model reserves far less output than its window', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'models', { body: '{}' })
  for (const model of body.value.models) {
    assert.ok(model.maxTokens < model.contextWindow / 2,
      `${model.id}: maxTokens ${model.maxTokens} must not crowd out ${model.contextWindow}`)
  }
})

test('read answers no-vault when no credential service is mounted', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status, body } = await hit(routes, 'read', { body: '{}' })
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.value.state, 'no-vault')
})

test('read answers signed-out when the vault holds nothing', async () => {
  const { ctx, routes } = fakeCtx({
    services: { credentials: { readRecord: async () => undefined, deleteRecord: async () => {} } },
  })
  apply(ctx)
  const { body } = await hit(routes, 'read', { body: '{}' })
  assert.equal(body.value.state, 'signed-out')
})

test('a failing credential read is a refused result, not a throw', async () => {
  const { ctx, routes } = fakeCtx({
    services: {
      credentials: {
        readRecord: async () => { throw new Error('vault offline') },
        deleteRecord: async () => {},
      },
    },
  })
  apply(ctx)
  const { status, body } = await hit(routes, 'read', { body: '{}' })
  assert.equal(status, 200)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/failed')
})

test('loginStart refuses cleanly when authorization is absent', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'loginStart', { body: '{}' })
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/no-authorization')
})

test('loginPoll for an unknown attempt reports expiry', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'loginPoll', { body: JSON.stringify({ loginId: 'nope' }) })
  assert.equal(body.ok, true)
  assert.equal(body.value.status, 'expired')
})

test('signOut without a vault is refused, not thrown', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { body } = await hit(routes, 'signOut', { body: '{}' })
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'grok/no-vault')
})

test('signOut clears the stored record when a vault exists', async () => {
  const deleted = []
  const { ctx, routes } = fakeCtx({
    services: {
      credentials: {
        readRecord: async () => undefined,
        deleteRecord: async (key) => { deleted.push(key) },
      },
    },
  })
  apply(ctx)
  const { body } = await hit(routes, 'signOut', { body: '{}' })
  assert.equal(body.ok, true)
  assert.deepEqual(deleted, ['llm-pi-ai/xai'])
})

test('a non-loopback Host is refused', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status, body } = await hit(routes, 'read', { body: '{}', headers: { host: 'evil.example' } })
  assert.equal(status, 403)
  assert.equal(body.ok, false)
})

test('a cross-origin request is refused', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status } = await hit(routes, 'read', {
    body: '{}',
    headers: { host: '127.0.0.1:1', origin: 'https://evil.example' },
  })
  assert.equal(status, 403)
})

test('only POST is accepted', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status, body } = await hit(routes, 'read', { method: 'GET', body: '{}' })
  assert.equal(status, 405)
  assert.equal(body.ok, false)
})

test('a malformed body is a 400, not a crash', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const { status, body } = await hit(routes, 'read', { body: '{not json' })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'grok/bad-request')
})

test('an oversized body is refused rather than buffered', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx)
  const huge = JSON.stringify({ pad: 'x'.repeat(9000) })
  const { status, body } = await hit(routes, 'read', { body: huge })
  assert.equal(status, 400)
  assert.equal(body.error.code, 'grok/bad-request')
})
