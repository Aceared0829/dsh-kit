/**
 * Regression tests for {@link snapshotOf}: the combination rules between the
 * two independent quota reads, and the one fact this plugin got wrong once —
 * the access token's claims carry no email, so the profile endpoint must be
 * consulted before the token.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { snapshotOf } from '../index.js'

/** A grant whose JWT deliberately has no `email` claim, matching production. */
const grant = {
  type: 'oauth',
  access: 'h.' + Buffer.from(JSON.stringify({ sub: 'u1', exp: 1792423177 })).toString('base64url') + '.s',
  refresh: 'r',
  expires: 1792423177074,
}

const billing = {
  config: {
    currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-10-15T06:05:31Z', end: '2026-10-22T06:05:31Z' },
    creditUsagePercent: 14,
  },
}

const user = { email: 'a@b.c', subscriptionTier: 'SuperGrokPro', hasGrokCodeAccess: true }

test('both reads succeeding yields a ready snapshot with the profile email', () => {
  const snap = snapshotOf({ grant, claims: {}, billing, user })
  assert.equal(snap.state, 'ready')
  assert.equal(snap.email, 'a@b.c')
  assert.equal(snap.plan, 'SuperGrokPro')
  assert.equal(snap.tier, true)
  assert.equal(snap.quota.usedPercent, 14)
})

test('the profile email is the source; the token claim is only a fallback', () => {
  assert.equal(snapshotOf({ grant, claims: { email: 'claim@x.y' }, billing, user }).email, 'a@b.c')
  assert.equal(snapshotOf({ grant, claims: { email: 'claim@x.y' }, billing, user: undefined }).email, 'claim@x.y')
  // The production token has no email at all; nothing must invent one.
  assert.equal(snapshotOf({ grant, claims: {}, billing, user: undefined }).email, null)
})

test('billing alone still reports ready, with no plan', () => {
  const snap = snapshotOf({ grant, claims: {}, billing, user: undefined })
  assert.equal(snap.state, 'ready')
  assert.equal(snap.plan, null)
  assert.equal(snap.quota.usedPercent, 14)
})

test('profile alone still reports ready, with no quota', () => {
  const snap = snapshotOf({ grant, claims: {}, billing: undefined, user })
  assert.equal(snap.state, 'ready')
  assert.equal(snap.quota, null)
  assert.equal(snap.plan, 'SuperGrokPro')
})

test('both reads failing is unavailable, never signed-out', () => {
  const snap = snapshotOf({ grant, claims: {}, billing: undefined, user: undefined })
  assert.equal(snap.state, 'unavailable')
  // The grant is still present, which is what keeps the card signed in.
  assert.equal(typeof snap.expiresAtMs, 'number')
})

test('a grant without a stated expiry falls back to the token exp claim', () => {
  const snap = snapshotOf({
    grant: { type: 'oauth', access: grant.access, refresh: 'r' },
    claims: {}, billing, user,
  })
  assert.equal(snap.expiresAtMs, 1792423177 * 1000)
})
