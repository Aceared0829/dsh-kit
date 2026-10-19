/**
 * The bundle's own patch must insert the row, not override an absent one.
 *
 * This is the bug that shipped first: a profile patch written as a bare
 * `- id: dsh-connect-grok` is an *override*, and a Loader override naming an
 * entry that does not exist does nothing at all — silently. The plugin still
 * appeared, because a profile patch layer and the bundle patch layer are read
 * differently, and the symptom was a settings page that rendered its nav tab
 * with an empty body while the Host half was reported `absent`.
 *
 * The fix is that the bundle patch uses `insert:`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const patchPath = join(here, '..', 'cordis.patch.yml')
const manifestPath = join(here, '..', 'package.json')

const patch = readFileSync(patchPath, 'utf8')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

test('the patch is an insert list, not a bare override', () => {
  assert.match(patch, /^-\s*insert:/m, 'the patch must start an insert list')
  assert.doesNotMatch(
    patch,
    /^-\s+id:/m,
    'a top-level `- id:` with no insert wrapper is an override, and an override of a'
    + ' non-existent entry silently does nothing',
  )
})

test('the patch inserts exactly the package name', () => {
  const names = [...patch.matchAll(/^\s+name:\s*(\S+)\s*$/gm)].map(m => m[1])
  assert.deepEqual(names, [manifest.name])
})

test('the patch row id matches the package name', () => {
  const ids = [...patch.matchAll(/^\s+-\s+id:\s*(\S+)\s*$/gm)].map(m => m[1])
  assert.deepEqual(ids, [manifest.name])
})

test('the manifest points at the patch that exists', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('every declared export exists on disk', () => {
  const root = join(here, '..')
  for (const [key, value] of Object.entries(manifest.exports)) {
    if (value.includes('*')) continue
    assert.doesNotThrow(
      () => readFileSync(join(root, value)),
      `export ${key} -> ${value} must exist`,
    )
  }
})

test('declared locale and icon exports are present', () => {
  const root = join(here, '..')
  for (const file of ['locale/en.json', 'locale/zh.json', 'icon.svg']) {
    assert.doesNotThrow(() => readFileSync(join(root, file)), `${file} must exist`)
  }
})

test('the client manifest injects the packages the card reads', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
})
