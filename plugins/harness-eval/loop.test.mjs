/**
 * Tests for the closed loop.
 *
 * The loop is the one place that ACTS on a measurement, so the tests are about
 * the action, not the arithmetic: does it refuse thin evidence, does it revert
 * when told, and does a failed revert stay honest about failing.
 *
 * A stub probe supplies the measurements, and a temporary ledger supplies the
 * state, so nothing here touches the real skill directory.
 *
 *   node --test plugins/harness-eval/loop.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { iterate, status } from './lib/loop.js'
import { applyChange, readLedger } from './lib/ledger.js'

/**
 * A workspace with one applied change and a stub probe.
 * @param sides - what the probe returns for the before/after windows.
 */
function fixture(sides) {
  const root = mkdtempSync(join(tmpdir(), 'loop-test-'))
  const skills = join(root, 'skills')
  const ledgerDir = join(root, 'ledger')
  mkdirSync(skills, { recursive: true })
  const target = join(skills, 'skill', 'SKILL.md')
  const change = applyChange({
    ledgerDir,
    roots: [skills],
    target,
    after: 'changed content',
    candidateId: 'test-candidate',
    hypothesis: 'the metric falls',
  })
  let call = 0
  const probe = {
    measure() {
      const side = sides[Math.min(call, sides.length - 1)]
      call += 1
      return side
    },
  }
  return { root, skills, ledgerDir, target, change, probe }
}

/** A measurement side. */
const side = (sessions, metric, cost = 100_000) => ({ sessions, metric, cost })

test('it measures before and after at the change\'s own timestamp', () => {
  // The boundary must come from the ledger, not from the caller: two runs of the
  // loop on the same change have to split the sessions the same way.
  const f = fixture([side(10, 40), side(10, 10)])
  const windows = []
  let call = 0
  const decision = iterate({
    ledgerDir: f.ledgerDir,
    roots: [f.skills],
    changeId: f.change.id,
    probe: {
      measure: (options) => {
        windows.push(options)
        const index = Math.min(call, 1)
        call += 1
        return index === 0 ? side(10, 40) : side(10, 10)
      },
    },
    window: { home: '/unused' },
  })
  assert.equal(decision.decision, 'kept')
  assert.equal(windows.length, 2, 'the loop measures exactly two sides')
  // The first call bounds the past, the second the present. Both take the
  // boundary from the ledger rather than from a caller-supplied date.
  assert.equal(typeof windows[0].until, 'number')
  assert.equal(windows[1].since, windows[0].until, 'both sides must split at the SAME instant')
  assert.equal(windows[0].since, undefined)
  assert.equal(windows[1].until, undefined)
  rmSync(f.root, { recursive: true, force: true })
})

test('a real improvement is kept and the file stays', () => {
  const f = fixture([side(10, 40), side(10, 10)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  assert.equal(decision.decision, 'kept')
  assert.equal(decision.action, 'kept')
  assert.match(readFileSync(f.target, 'utf8'), /changed content/)
  rmSync(f.root, { recursive: true, force: true })
})

test('a worsening is reverted and the file goes back', () => {
  const f = fixture([side(10, 40), side(10, 80)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  assert.equal(decision.decision, 'reverted')
  assert.equal(decision.action, 'reverted')
  assert.ok(decision.revertId, 'a revert must be recorded with its own id')
  // The file was created by the change, so a revert removes it entirely.
  assert.equal(existsSync(f.target), false)
  rmSync(f.root, { recursive: true, force: true })
})

test('thin evidence is not acted on', () => {
  // One session after the change is not enough to decide anything, however good
  // the number looks.
  const f = fixture([side(10, 40), side(1, 1)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  assert.equal(decision.decision, 'inconclusive')
  assert.equal(decision.action, 'none')
  assert.match(decision.missing, /more session/)
  // The change must still be in force: inconclusive is not a revert.
  assert.match(readFileSync(f.target, 'utf8'), /changed content/)
  rmSync(f.root, { recursive: true, force: true })
})

test('the empty-after case explains itself instead of looking like a bug', () => {
  const f = fixture([side(10, 40), side(0, 0)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  assert.equal(decision.decision, 'inconclusive')
  assert.match(decision.missing, /No session has run since the change/)
  rmSync(f.root, { recursive: true, force: true })
})

test('a cost rise reverts even a large improvement', () => {
  const f = fixture([side(10, 40, 100_000), side(10, 10, 200_000)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  assert.equal(decision.decision, 'reverted')
  assert.equal(decision.reason, 'cost-rose')
  rmSync(f.root, { recursive: true, force: true })
})

test('an unknown change is refused rather than guessed at', () => {
  const f = fixture([side(10, 40), side(10, 10)])
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: 'chg-nope', probe: f.probe, window: {} })
  assert.equal(decision.decision, 'inconclusive')
  assert.equal(decision.reason, 'no-such-change')
  rmSync(f.root, { recursive: true, force: true })
})

test('every decision is written to the ledger', () => {
  const f = fixture([side(10, 40), side(10, 10)])
  iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  const verdicts = readLedger(f.ledgerDir).filter(entry => entry.outcome === 'verdict')
  assert.equal(verdicts.length, 1, 'a decision with no ledger entry is indistinguishable from doing nothing')
  assert.equal(verdicts[0].verdict, 'kept')
  assert.equal(verdicts[0].verdictOf, f.change.id)
  rmSync(f.root, { recursive: true, force: true })
})

test('a revert that cannot run is reported as failed, not as done', () => {
  const f = fixture([side(10, 40), side(10, 80)])
  // Remove the file first so the ledger's before-image no longer matches the
  // world; the revert must still be attempted and any failure surfaced.
  rmSync(f.skills, { recursive: true, force: true })
  const decision = iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  // Either it reverted cleanly or it says it failed — but it must never claim
  // success while leaving the change in place.
  if (decision.action === 'reverted') {
    assert.equal(existsSync(f.target), false)
  } else {
    assert.equal(decision.action, 'revert-failed')
    assert.match(decision.detail, /revert failed/)
  }
  rmSync(f.root, { recursive: true, force: true })
})

test('status reports force state and the latest verdict', () => {
  const f = fixture([side(10, 40), side(10, 10)])
  iterate({ ledgerDir: f.ledgerDir, roots: [f.skills], changeId: f.change.id, probe: f.probe, window: {} })
  const rows = status(f.ledgerDir)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, f.change.id)
  assert.equal(rows[0].inForce, true)
  assert.equal(rows[0].verdict, 'kept')
  rmSync(f.root, { recursive: true, force: true })
})
