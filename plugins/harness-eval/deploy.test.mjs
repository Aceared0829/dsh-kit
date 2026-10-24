/**
 * Guard the deployed host half against source drift.
 *
 * The profile loads `lib/index.js`, so `src/index.js` is only the source of
 * truth if they stay byte-identical. Editing one and deploying the other is a
 * silent failure: the running system keeps the old behavior while the
 * repository looks correct.
 *
 *   node --test plugins/harness-eval/deploy.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { posix } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path) => readFileSync(join(here, path), 'utf8')

test('the deployed host half matches its source', () => {
  assert.equal(
    read('lib/index.js'),
    read('src/index.js'),
    'lib/index.js drifted from src/index.js: run `cp src/index.js lib/index.js`',
  )
})

test('the deployed Remote spec matches its source', () => {
  assert.equal(
    read('lib/typert.remote-client.js'),
    read('src/remote-spec.js'),
    'lib/typert.remote-client.js drifted from src/remote-spec.js',
  )
})

test('the client bundle registers the package id it is published under', () => {
  const bundle = read('lib/client.js')
  const manifest = JSON.parse(read('package.json'))
  const declared = /id:\s*'([^']+)'/.exec(bundle)
  assert.ok(declared !== null, 'lib/client.js must declare a bundle id')
  assert.equal(declared[1], manifest.name,
    'the bundle id must equal the package name; the loader keys registrations by it')
})

test('every relative runtime import in the host half resolves to a shipped file', () => {
  // The host half must be self-contained: `files` publishes only what it lists,
  // so a relative import outside that set breaks the published package.
  const source = read('lib/index.js')
  const manifest = JSON.parse(read('package.json'))
  const shipped = new Set(manifest.files)
  const specifiers = [...source.matchAll(/from\s+'(\.\.?\/[^']+)'/g)].map(match => match[1])
  for (const specifier of specifiers) {
    // `files` entries use forward slashes; resolve on the current platform and
    // normalize back so Windows separators do not mask a real mismatch.
    const resolved = posix.join('lib', specifier)
    assert.ok(shipped.has(resolved),
      `lib/index.js imports ${specifier} (published as ${resolved}), which package.json "files" does not list`)
  }
})

test('the manifest ships every module the host half loads', () => {
  const manifest = JSON.parse(read('package.json'))
  for (const required of ['lib/index.js', 'lib/marks.js', 'lib/client.js', 'cordis.patch.yml', 'README.md']) {
    assert.ok(manifest.files.includes(required), `package.json "files" must include ${required}`)
  }
})
