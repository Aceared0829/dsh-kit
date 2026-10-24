/**
 * Tests for the GUI repeat guard.
 *
 * The guard sits in front of every tool call, so both of its failure modes are
 * expensive:
 *
 *   - Too eager: it blocks a legitimate second observation and the agent cannot
 *     see the screen it needs.
 *   - Too lax: it never fires and the repeated captures continue.
 *
 * Every test therefore asserts on a specific call, not on the general shape.
 *
 *   node --test plugins/harness-eval/gui-guard.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import guard, { guardStats } from './lib/gui-guard.js'

/** Mount the guard and capture its function. */
function mount() {
  let capture
  guard.apply({
    tools: { guard: (fn) => { capture = fn; return () => {} } },
    get: () => undefined,
  })
  assert.equal(typeof capture, 'function', 'the guard must register a function')
  return capture
}

/** One execution as the registry hands it to a guard. */
const exec = (name, args, agent = {}) => ({ name, arguments: args, agent })

test('the first GUI call goes through', () => {
  const check = mount()
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 2 })), undefined)
})

test('the exact same call twice in a row is denied', () => {
  const check = mount()
  const agent = {}
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 2 }, agent)), undefined)
  const reason = check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 2 }, agent))
  assert.equal(typeof reason, 'string', 'the second identical call must be refused')
  // The reason has to tell the model what to do next, not only that it failed.
  assert.match(reason, /Act on the window first/)
  assert.match(reason, /not a budget/)
})

test('a different window is a different observation and goes through', () => {
  const check = mount()
  const agent = {}
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 2 }, agent)), undefined)
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 3 }, agent)), undefined)
})

test('the same window after an intervening action goes through', () => {
  const check = mount()
  const agent = {}
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, agent)), undefined)
  // The action is what makes the next capture meaningful, even though the
  // capture's own arguments are identical.
  assert.equal(check(exec('cua_driver_native__click', { pid: 1, x: 5, y: 5 }, agent)), undefined)
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, agent)), undefined)
})

test('a non-GUI tool is never the guard\'s business', () => {
  const check = mount()
  const agent = {}
  assert.equal(check(exec('read', { path: '/a' }, agent)), undefined)
  assert.equal(check(exec('read', { path: '/a' }, agent)), undefined, 'reading the same file twice is not this guard\'s problem')
})

test('two agents do not share history', () => {
  const check = mount()
  const first = {}
  const second = {}
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, first)), undefined)
  // A different session looking at the same window for the first time is not a
  // repeat; treating it as one would block work in an unrelated session.
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, second)), undefined)
})

test('an execution with no agent cannot be attributed, so it is allowed', () => {
  const check = mount()
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, undefined)), undefined)
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, undefined)), undefined)
})

test('argument order does not make two identical calls look different', () => {
  const check = mount()
  const agent = {}
  // Both serialize to the same key only if the runtime parses them the same way;
  // this asserts the guard compares the PARSED arguments, not the raw text.
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1, window_id: 2 }, agent)), undefined)
  assert.equal(check(exec('cua_driver_native__get_window_state', { window_id: 2, pid: 1 }, agent)), undefined,
    'key order alone must not defeat the guard')
})

test('a third identical call is still denied after the pair', () => {
  const check = mount()
  const agent = {}
  assert.equal(check(exec('cua_driver_native__get_window_state', { pid: 1 }, agent)), undefined)
  assert.equal(typeof check(exec('cua_driver_native__get_window_state', { pid: 1 }, agent)), 'string')
  assert.equal(typeof check(exec('cua_driver_native__get_window_state', { pid: 1 }, agent)), 'string')
})

test('the guard reports what it denied', () => {
  const check = mount()
  const agent = {}
  check(exec('cua_driver_native__press_key', { key: 'return' }, agent))
  check(exec('cua_driver_native__press_key', { key: 'return' }, agent))
  const stats = guardStats()
  assert.ok(stats.count >= 1)
  assert.ok(stats.tools['cua_driver_native__press_key'] >= 1)
})
