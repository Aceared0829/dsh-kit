/**
 * Unit tests for the pure Host helpers. Run with `node --test tests/`.
 *
 * Only the projections are covered here: everything else in the Host half is
 * I/O against services this test cannot mount. The projection is where a wrong
 * answer is silent — a mis-read percentage shows a plausible number that means
 * the opposite thing — so it is the part worth pinning.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { quotaOf, claimsOf, fingerprint } from '../index.js'

test('quotaOf reads the credits-config shape', () => {
  const quota = quotaOf({
    config: {
      currentPeriod: {
        type: 'USAGE_PERIOD_TYPE_WEEKLY',
        start: '2026-10-15T06:05:31.254624+00:00',
        end: '2026-10-22T06:05:31.254624+00:00',
      },
      creditUsagePercent: 14.0,
      onDemandCap: { val: 0 },
      onDemandUsed: { val: 0 },
      prepaidBalance: { val: 0 },
      isUnifiedBillingUser: true,
    },
  })
  assert.equal(quota.usedPercent, 14.0)
  assert.equal(quota.period, 'weekly')
  assert.equal(quota.periodEnd, '2026-10-22T06:05:31.254624+00:00')
  assert.equal(typeof quota.resetsAtMs, 'number')
  assert.equal(quota.onDemandCap, 0)
  assert.equal(quota.unified, true)
})

test('quotaOf accepts the deprecated legacy fields', () => {
  const quota = quotaOf({
    config: {
      monthlyLimit: { val: 0 },
      used: { val: 0 },
      billingPeriodStart: '2026-10-01T00:00:00+00:00',
      billingPeriodEnd: '2026-11-01T00:00:00+00:00',
    },
  })
  assert.equal(quota.usedPercent, null)
  assert.equal(quota.period, null)
  assert.equal(quota.periodEnd, '2026-11-01T00:00:00+00:00')
  assert.equal(typeof quota.resetsAtMs, 'number')
})

test('quotaOf returns null when the body carries no period at all', () => {
  assert.equal(quotaOf({}), null)
  assert.equal(quotaOf(null), null)
  assert.equal(quotaOf({ config: null }), null)
})

test('claimsOf decodes a JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'a@b.c', exp: 123, sub: 'x' })).toString('base64url')
  const token = 'header.' + payload + '.sig'
  assert.deepEqual(claimsOf(token), { email: 'a@b.c', exp: 123, sub: 'x' })
})

test('claimsOf refuses a non-JWT', () => {
  assert.equal(claimsOf('not-a-token'), undefined)
  assert.equal(claimsOf(undefined), undefined)
  assert.equal(claimsOf('a.!!!.c'), undefined)
})

test('fingerprint never returns token material', () => {
  assert.equal(fingerprint('abcdefghij'), '10c')
  assert.equal(fingerprint(''), 'empty')
  assert.equal(fingerprint(undefined), 'empty')
})
