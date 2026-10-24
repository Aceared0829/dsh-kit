/**
 * Guard the hand-written Remote spec against drift from the Host service.
 *
 * `src/remote-spec.js` (bundled into `lib/client.js`) and `src/marks-service.ts`
 * are two declarations of the same contract: the spec tells the Gateway which
 * endpoints exist and how to parse them, while the decorators tell the Host
 * which methods answer. Nothing checks that they agree at build time — a
 * mismatch shows up as a rejected call at runtime — so this test compares them
 * directly.
 *
 *   node --test plugins/harness-eval/remote-spec.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const spec = (await import('./lib/typert.remote-client.js')).default
const service = (await import('./lib/marks-service.js')).default
const { Context } = await import('@deepseek-ai/cordis')
const here = dirname(fileURLToPath(import.meta.url))

/** The key the protocol's decorators write the Remote metadata under. */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * Read the methods the `@Remote` decorators marked on a service class.
 *
 * The metadata is written onto the prototype during construction, so a real
 * instance (with stubbed injections) is required to observe it.
 * @returns the marked method names, sorted.
 */
function decoratedMethods() {
  const ctx = new Context()
  // The service opens its storage domain on construction; answer with a stub.
  Object.defineProperty(ctx, 'storageDomain', {
    value: {
      open: async () => ({
        table: () => ({ entries: () => [], put: async () => {}, delete: async () => false }),
        close: async () => {},
      }),
    },
  })
  const instance = new service(ctx)
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), REMOTE_METHODS)
  if (descriptor === undefined) return []
  return descriptor.value.methods.map(method => method.method).sort()
}

/** The endpoints the hand-written spec declares, as bare method names. */
function speccedMethods() {
  return spec.descriptors
    .filter(descriptor => descriptor.namespace === 'harnessMarks')
    .map(descriptor => descriptor.method)
    .sort()
}

test('the spec declares exactly the methods the service decorates', () => {
  assert.deepEqual(
    speccedMethods(),
    decoratedMethods(),
    'src/remote-spec.js and src/marks-service.ts disagree: update the spec to match the @Remote methods',
  )
})

test('the service is not empty, so the comparison above is meaningful', () => {
  // Guards against both sides silently collapsing to [].
  assert.ok(decoratedMethods().length > 0, 'the service must decorate at least one method')
  assert.ok(speccedMethods().length > 0, 'the spec must declare at least one endpoint')
})

test('no endpoint collides with the Client namespace service API', () => {
  // api-gateway installs methods onto its RemoteNamespaceService instance.
  // A method sharing a field or member of that service is rejected before
  // the namespace mounts. Read gateway source directly so a field added there
  // cannot be forgotten in a hand-maintained list. Point DSH_CHECKOUT at your
  // checkout when it is not the parent of this kit's install location.
  const checkout = process.env.DSH_CHECKOUT ?? join(here, '..', '..')
  const gateway = readFileSync(join(
    checkout, 'packages', 'api', 'gateway', 'src', 'client', 'index.ts',
  ), 'utf8')
  const fieldList = /const REMOTE_NAMESPACE_FIELDS = new Set\(\[([^\]]+)\]\)/.exec(gateway)
  assert.notEqual(fieldList, null, 'gateway source must declare REMOTE_NAMESPACE_FIELDS')
  const classBody = /class RemoteNamespaceService extends Service \{([\s\S]*?)^\}/m.exec(gateway)
  assert.notEqual(classBody, null, 'gateway source must declare RemoteNamespaceService')
  const memberMatches = [...classBody[1].matchAll(/^\s{2}(?:private |readonly |static )*(?:get )?([A-Za-z_$][\w$]*)\s*(?:\(|:)/gm)]
  const members = memberMatches.map(match => match[1])
  const fieldNames = []
  for (const match of fieldList[1].matchAll(/'([^']+)'/g)) fieldNames.push(match[1])
  const reserved = new Set([
    ...fieldNames,
    ...members,
  ])
  for (const descriptor of spec.descriptors) {
    assert.equal(reserved.has(descriptor.method), false,
      `${descriptor.id} uses reserved namespace method ${descriptor.method}`)
  }
})

test('every endpoint names the service namespace', () => {
  for (const descriptor of spec.descriptors) {
    assert.equal(descriptor.namespace, 'harnessMarks')
    assert.equal(descriptor.service, 'harnessMarks')
  }
})

test('every endpoint is a direct invocation', () => {
  // A scoped or stream invocation would need different client handling; the
  // marks service uses none.
  for (const descriptor of spec.descriptors) {
    assert.deepEqual(descriptor.invocation, { kind: 'direct' })
  }
})

test('every parameter carries both codec policies', () => {
  // Generated artifacts always carry both; the Gateway reads the one matching
  // the call's policy, so a missing one fails at dispatch.
  for (const descriptor of spec.descriptors) {
    for (const parameter of descriptor.parameters) {
      assert.ok(parameter.codec !== undefined, `${descriptor.id}:${parameter.wire} has no codec`)
      assert.equal(typeof parameter.codec.create, 'function')
      assert.ok(parameter.strictCodec !== undefined, `${descriptor.id}:${parameter.wire} has no strictCodec`)
      assert.equal(typeof parameter.strictCodec.create, 'function')
    }
  }
})

test('every declared parameter codec parses a plausible value', () => {
  // A codec that throws on its own declared shape would reject every call.
  const samples = {
    'harnessMarks/create': { sessionId: 's', turn: 1, kind: 'failure', reason: 'r' },
    'harnessMarks/list': { sessionId: 's' },
    'harnessMarks/discard': { id: 'm1' },
  }
  for (const descriptor of spec.descriptors) {
    const sample = samples[descriptor.id.split('#')[1]]
    if (sample === undefined) continue
    const [parameter] = descriptor.parameters
    assert.doesNotThrow(() => parameter.codec.create().parse(sample),
      `${descriptor.id} rejects its own declared request shape`)
  }
})

test('every result codec parses a plausible value', () => {
  const samples = {
    'harnessMarks/ping': 'pong',
    'harnessMarks/create': { id: 'm1', turn: 1, kind: 'failure', reason: 'r', createdAt: 1 },
    'harnessMarks/list': [],
    'harnessMarks/discard': true,
  }
  for (const descriptor of spec.descriptors) {
    const endpoint = descriptor.id.split('#')[1]
    const sample = samples[endpoint]
    if (sample === undefined) continue
    assert.doesNotThrow(() => descriptor.result.create().parse(sample),
      `${endpoint} rejects its own declared result shape`)
  }
})
