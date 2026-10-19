/**
 * Harness contracts for the two halves, pinned as source assertions.
 *
 * Each entry here is a failure that actually shipped to a real settings page
 * and produced no visible error:
 *
 *   1. `ctx` reached render, the service proxy refused a property, and the slot
 *      registry retired the entry — a nav tab with a permanently blank body.
 *   2. The card called `t.errorTitle`. `locale.bind()` returns a *function*, so
 *      every such read was `undefined` and the card rendered blank labels.
 *   3. The card asked the page for `ctx.connection`. That service lives on the
 *      Host half only; the page reported `no connection` and never reached the
 *      Host at all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'client.js'), 'utf8')
const host = readFileSync(join(here, '..', 'index.js'), 'utf8')

test('the component never receives or reads a context', () => {
  assert.doesNotMatch(client, /props\.ctx\b/)
  assert.doesNotMatch(client, /var ctx = props\./)
  // Comments may *mention* the service; what matters is that no code reads it.
  const code = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /ctx\.connection/)
})

test('no bare `t.property` reads: bind() returns a translate function', () => {
  // `t('title')` is correct; `t.title` is `undefined` on a function.
  const offenders = [...client.matchAll(/\bt\.([A-Za-z][A-Za-z0-9]*)\b(?!\s*\()/g)]
    .map(m => m[0])
    .filter(token => token !== 't.transport')
  assert.deepEqual(offenders, [], 'every copy string must be read with t(\'key\')')
})

test('the card reaches the Host over its own web routes', () => {
  assert.match(client, /var ROUTE_PREFIX = '\/plugins\/dsh-connect-grok'/)
  assert.match(client, /fetch\(ROUTE_PREFIX \+ '\/' \+ method/)
  assert.doesNotMatch(client, /rpc\.call/)
})

test('the Host registers one exact route per endpoint, inside inject', () => {
  // The dependency argument is a RECORD: an array is rejected by the loader and
  // the callback never runs, so the routes silently never register.
  assert.match(host, /ctx\.inject\(\{ webServer: true \}/)
  assert.match(host, /serverCtx\.webServer\.register/)
  for (const endpoint of ['read', 'loginStart', 'loginPoll', 'signOut']) {
    assert.match(host, new RegExp(`'${endpoint}'`), `${endpoint} must be a route`)
  }
})

test('credential-bearing routes are bound to loopback', () => {
  assert.match(host, /function isLoopbackRequest/)
  assert.match(host, /sendJson\(res, 403/)
  assert.match(host, /POST only/)
})

test('the transport always resolves to a shaped result', () => {
  // A rejected fetch, a non-2xx, and an unexpected body must all still produce
  // `{ok:false, error}`, because the card indexes into that shape.
  assert.match(client, /ok: false, error: \{ code: 'http\//)
  assert.match(client, /code: 'grok\/bad-response'/)
  assert.match(client, /code: 'grok\/transport'/)
})
