/**
 * Tests for sibling grouping — the rule that decides which sessions are a
 * controlled comparison and which only look like one.
 *
 * The failure this guards against is not a crash: it is a group of unrelated
 * runs averaged together and reported as an experiment. So every test asserts
 * on the REASON a group was rejected, not merely on `comparable: false`.
 *
 *   node --test plugins/harness-eval/siblings.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { INCOMPARABLE, groupSiblings, inheritedCut } from './lib/siblings.js'

/** One session summary, with only the fields grouping reads. */
const child = (overrides = {}) => ({
  sessionId: 's',
  parentSession: 'p',
  origin: null,
  createdAt: 0,
  isSeeded: true,
  cut: 10,
  turns: 3,
  calls: 20,
  inputTokens: 1000,
  outputTokens: 100,
  promptHash: 'aaaa',
  ...overrides,
})

test('two forks cut at the same boundary with the same prompt are comparable', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a' }),
    child({ sessionId: 'b' }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].comparable, true)
  assert.deepEqual(groups[0].reasons, [])
  // Comparable input matching is NOT a claim that the harness varied.
  assert.match(groups[0].varies, /harness variation not yet recorded/)
})

test('a fork that never ran makes the group non-comparable', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a', turns: 0, calls: 0 }),
    child({ sessionId: 'b' }),
  ])
  assert.equal(groups[0].comparable, false)
  assert.ok(groups[0].reasons.includes(INCOMPARABLE.onlyOneRan))
})

test('forks cut at different boundaries did not start from the same state', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a', cut: 10 }),
    child({ sessionId: 'b', cut: 99 }),
  ])
  assert.equal(groups[0].comparable, false)
  assert.ok(groups[0].reasons.includes(INCOMPARABLE.differentCut))
})

test('subagents sharing a parent are not forks, and a null cut is never "the same"', () => {
  // `cut: null` means the child inherited no prefix. Two of them landing in the
  // same group must not read as an experiment at one boundary.
  const groups = groupSiblings([
    child({ sessionId: 'a', cut: null, isSeeded: false }),
    child({ sessionId: 'b', cut: null, isSeeded: false }),
  ])
  assert.equal(groups[0].comparable, false)
  assert.ok(groups[0].reasons.includes(INCOMPARABLE.notForks))
  assert.equal(groups[0].children.every(entry => entry.isFork === false), true)
})

test('two children given different tasks cannot attribute a difference to the harness', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a', promptHash: 'aaaa' }),
    child({ sessionId: 'b', promptHash: 'bbbb' }),
  ])
  assert.equal(groups[0].comparable, false)
  assert.ok(groups[0].reasons.includes(INCOMPARABLE.differentPrompt))
})

test('a group where nothing ran reports neverRan as well as onlyOneRan', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a', turns: 0 }),
    child({ sessionId: 'b', turns: 0 }),
  ])
  assert.ok(groups[0].reasons.includes(INCOMPARABLE.neverRan))
})

test('a parent with one child is not a group', () => {
  const groups = groupSiblings([child({ sessionId: 'a' })])
  assert.equal(groups.length, 0)
})

test('sessions with no parent are ignored', () => {
  const groups = groupSiblings([
    child({ sessionId: 'a', parentSession: null }),
    child({ sessionId: 'b', parentSession: null }),
  ])
  assert.equal(groups.length, 0)
})

test('the inherited cut comes from the header seedLength, else the end-seed marker', () => {
  assert.equal(inheritedCut([{ type: 'session', isSeeded: true, seedLength: 42 }]), 42)
  assert.equal(inheritedCut([
    { type: 'session', isSeeded: true },
    { type: 'session/end-seed', seq: 7, data: { inherited: true } },
  ]), 7)
  // Unseeded sessions started on their own.
  assert.equal(inheritedCut([{ type: 'session', isSeeded: false }]), null)
  // Seeded but with no recorded cut is unknown, not zero.
  assert.equal(inheritedCut([{ type: 'session', isSeeded: true }]), null)
})
