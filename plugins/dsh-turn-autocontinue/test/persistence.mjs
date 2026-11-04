/**
 * Persistence round-trip check for @local/dsh-turn-autocontinue.
 *
 * The plugin writes ordinary `user/message` events carrying
 * `source.kind === 'turn-autocontinue'`, so they must survive the real JSONL
 * persistence backend and read back as the same events on restore. This suite proves
 * the writer contract against the real SessionStore + jsonl persistence from the
 * checkout (dev junctions required; see README "Development").
 *
 * Run: node test/persistence.mjs
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context } = await import('@deepseek-ai/cordis')
const SessionStore = (await import('@deepseek-ai/dsh-session')).default
const { SessionId } = await import('@deepseek-ai/dsh-session')
const SessionPersistenceJsonl = await import('@deepseek-ai/dsh-session-persistence-jsonl')

const plugin = await import('../lib/index.js')

let passed = 0
let failed = 0
const failures = []

async function test(title, body) {
  try {
    await body()
    passed += 1
    console.log('  PASS  ' + title)
  } catch (error) {
    failed += 1
    failures.push({ title, error })
    console.log('  FAIL  ' + title)
    console.log('        ' + (error && error.message ? error.message : String(error)))
  }
}

console.log('dsh-turn-autocontinue persistence round-trip')
console.log('')

await test('P1 a plugin notice survives JSONL persistence and reads back unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-autocontinue-'))
  try {
    const id = SessionId('persist-1')
    const message = plugin.createNoticeMessage('【自动续跑 第 1/3 次】\n先查看当前状态，不要盲目重做。', {
      phase: 'continue',
      attempt: 1,
      maxContinues: 3,
      code: 'MALFORMED_RESPONSE',
    })

    // Write side: a real store with the real jsonl backend.
    const writer = new Context()
    await writer.plugin(SessionStore)
    await writer.plugin(SessionPersistenceJsonl, { root })
    const session = writer.sessions.create(id, { cwd: root })
    // A live session persists only through an active write handle for its header.
    const handle = await writer.sessionPersistence.create(session.header)
    session.append('turn/start', { turn: 1 })
    // Exactly what the plugin does: a surface append carrying the identified message.
    session.append('user/message', message, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assert.equal(await writer.sessions.flush(session), true, 'the session flush was acknowledged')
    await handle.close()
    await writer.fiber.dispose()

    // Read side: the persistence backend reads the stored log straight back.
    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(SessionPersistenceJsonl, { root })
    const backend = reader.sessionPersistence
    assert.ok(backend !== undefined, 'the jsonl backend is mounted as sessionPersistence')
    const stat = await backend.stat(id)
    assert.ok(stat !== undefined, 'the stored session is visible to the backend')
    const readerHandle = await backend.open(id, 'read')
    const { events } = await readerHandle.read()
    await readerHandle.close()
    const restored = events.filter(event => event.type === 'user/message')
    assert.equal(restored.length, 1, 'the notice round-tripped')
    assert.equal(restored[0].data.source.kind, 'turn-autocontinue')
    assert.equal(restored[0].data.source.phase, 'continue')
    assert.equal(restored[0].data.source.attempt, 1)
    assert.match(restored[0].data.content[0].text, /先查看当前状态/)
    await reader.fiber.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

console.log('')
console.log('Total: ' + (passed + failed) + '  passed: ' + passed + '  failed: ' + failed)
if (failed > 0) {
  for (const failure of failures) {
    console.log('FAILED: ' + failure.title)
    if (failure.error && failure.error.stack) console.log(failure.error.stack)
  }
  process.exitCode = 1
} else {
  console.log('All persistence checks passed.')
}
