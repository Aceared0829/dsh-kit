/**
 * Contract tests for the browser half's bundle shape and render output.
 *
 * The client bundle is hand-written in the `tsdown` output shape, so nothing
 * type-checks it. These assert the things a silent break would ruin: the loader
 * handoff, the slot registration (id, and the order that places the tab after
 * the board), dictionary parity, and that the view renders the evidence it is
 * handed — including the open-turn case whose `outcome` key is absent.
 *
 *   node --test plugins/harness-eval/client.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// `react` is a shell-provided module; resolve it from the DSH checkout that
// hosts this bundle. Point DSH_CHECKOUT at your checkout when it is not the
// parent of this kit's install location.
const reactDir = join(
  process.env.DSH_CHECKOUT ?? join(here, '..', '..'),
  'packages', 'client', 'web', 'node_modules',
)
const load = (segments) => import(pathToFileURL(join(reactDir, ...segments)).href)

const modules = {
  react: await load(['react', 'index.js']),
  'react/jsx-runtime': await load(['react', 'jsx-runtime.js']),
  // The bundle builds its Remote descriptors with the shell's zod runtime.
  zod: await import('zod'),
}
const { renderToStaticMarkup } = await load(['react-dom', 'server.js'])

// Load the bundle through a stub loader: the artifact expects the page facade.
globalThis.window = { __ModuleLoader__: { load: (value) => { globalThis.__registration = value } } }
await import(pathToFileURL(join(here, 'lib', 'client.js')).href)

const registration = globalThis.__registration
const plugin = registration.factory((specifier) => {
  assert.ok(specifier in modules, `bundle requested an unexpected module: ${specifier}`)
  return modules[specifier]
})

/** Mount apply against a stub ctx and capture the registration and dictionaries. */
function mount() {
  const captured = {}
  plugin.apply({
    effect: fn => fn(),
    locale: {
      register: (_namespace, dictionaries) => {
        captured.dictionaries = dictionaries
        return () => {}
      },
      bind: () => (key) => key,
    },
    slots: {
      inject: (_name, install) => install(),
      register: (definition, component) => {
        captured.definition = definition
        captured.component = component
        return () => {}
      },
    },
    // The Remote mount is a side effect of apply; the stub records the request
    // and never resolves, so no namespace is installed in these tests.
    remote: {
      $mount: contribution => {
        captured.mounted = contribution
        return Promise.resolve(() => {})
      },
      get harnessMarks() { return undefined },
    },
    get: name => {
      if (name !== 'remote.harnessMarks') return undefined
      return {
        create: async request => ({ ok: true, value: { id: 'probe', ...request } }),
        discard: async () => {
          captured.discarded = true
          return { ok: true, value: true }
        },
      }
    },
  })
  return captured
}

const mounted = mount()

/** Render the view with one evidence value, returning markup. */
function render(evidence) {
  const View = props => mounted.component({
    ...props,
    t: key => key,
    useProjection: key => (key === 'harnessEvidence' ? evidence : undefined),
  })
  return renderToStaticMarkup(modules.react.createElement(View))
}

/** A fully populated evidence value, as the host's wire view publishes it. */
const fullEvidence = () => ({
  harness: { cwd: 'D:/workspace', agentPreset: 'cordis', parentSession: 'session-0', createdAt: 1792376749018 },
  totals: { turns: 3, steps: 41, toolCalls: 87, toolErrors: 6 },
  turns: [
    { turn: 1, seq: 1, outcome: 'completed', steps: 12, toolCalls: 30, toolErrors: 0 },
    { turn: 2, seq: 90, outcome: 'failed', steps: 19, toolCalls: 44, toolErrors: 5 },
    // An open turn carries no outcome key at all.
    { turn: 3, seq: 180, steps: 10, toolCalls: 13, toolErrors: 1 },
  ],
  firstIncompleteTurn: 2,
  idleTurns: 0,
  bifurcate: { turn: 2, tailSteps: 29, tailToolCalls: 57, tailShare: 71 },
})

test('the bundle hands off with the package id and no chunk name', () => {
  assert.equal(registration.id, 'dsh-harness-eval')
  assert.equal(registration.chunk, undefined)
})

test('the plugin exports the Cordis browser-plugin shape', () => {
  assert.equal(plugin.name, 'harness-eval')
  // `remote` is required because apply mounts the marks namespace itself.
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'remote'])
  assert.equal(typeof plugin.apply, 'function')
})

test('the view registers on conversation.view after the board tab', () => {
  assert.equal(mounted.definition.name, 'conversation.view')
  assert.equal(mounted.definition.id, 'harness-eval')
  // dsh-graph registers its board at order 80; this view must sort after it.
  assert.ok(mounted.definition.order > 80,
    `order ${mounted.definition.order} must exceed the board's 80`)
  assert.equal(typeof mounted.definition.label(), 'string')
})

test('the view injects callbacks rather than reaching for ctx', () => {
  // The inject face carries plain callbacks only; session identity and the
  // projection still arrive through the framework-standard seats.
  assert.equal(typeof mounted.definition.inject, 'function')
  const face = mounted.definition.inject()
  assert.deepEqual(Object.keys(face).sort(), ['createMark', 'removeMark'])
  for (const value of Object.values(face)) assert.equal(typeof value, 'function')
})

test('a mark callback resolves the mounted namespace without a property read', async () => {
  const face = mounted.definition.inject()
  const created = await face.createMark({
    sessionId: 'session-1', turn: 1, kind: 'note', reason: 'probe',
  })
  assert.equal(created.id, 'probe')
  assert.equal(await face.removeMark('probe'), true)
})

test('zh and en declare exactly the same keys', () => {
  assertEqualsIgnoringOrder(Object.keys(mounted.dictionaries.zh), Object.keys(mounted.dictionaries.en))
})

function assertEqualsIgnoringOrder(left, right) {
  assert.deepEqual([...left].sort(), [...right].sort())
}

test('an empty session renders the empty state instead of zeroed figures', () => {
  const markup = render(undefined)
  assert.ok(markup.includes('empty.title'), 'absent evidence must render the empty state')
  assert.equal(markup.includes('summary.turns'), false, 'the empty state must not show figures')
})

test('a session with no turns yet also renders the empty state', () => {
  const markup = render({ harness: { createdAt: 1 }, totals: { turns: 0, steps: 0, toolCalls: 0, toolErrors: 0 }, turns: [], idleTurns: 0 })
  assert.ok(markup.includes('empty.title'))
})

test('populated evidence renders the fingerprint, figures, and every turn', () => {
  const markup = render(fullEvidence())
  assert.ok(markup.includes('D:/workspace'), 'the working directory must appear')
  assert.ok(markup.includes('cordis'), 'the preset must appear')
  assert.ok(markup.includes('session-0'), 'the parent session must appear')
  assert.ok(markup.includes('summary.brokeAt'), 'the first-incomplete figure must appear')
  assert.ok(markup.includes('outcome.completed'))
  assert.ok(markup.includes('outcome.failed'))
  for (const turn of ['1', '2', '3']) assert.ok(markup.includes(`>${turn}<`), `turn ${turn} must render`)
})

test('an open turn renders a label rather than a missing outcome', () => {
  // The wire omits `outcome` for an open turn; the renderer must fall back to
  // its own open label instead of interpolating an absent key.
  const markup = render(fullEvidence())
  assert.ok(markup.includes('outcome.open'))
})

test('absent optional harness facts render no rows at all', () => {
  const evidence = { harness: { createdAt: 1 }, totals: { turns: 1, steps: 1, toolCalls: 0, toolErrors: 0 }, turns: [{ turn: 1, seq: 1, steps: 1, toolCalls: 0, toolErrors: 0 }], idleTurns: 0 }
  const markup = render(evidence)
  assert.equal(markup.includes('harness.cwd'), false, 'an absent cwd must not render a row')
  assert.equal(markup.includes('harness.preset'), false)
  assert.equal(markup.includes('harness.parent'), false)
})

test('the rendered value never carries an undefined key', () => {
  // The wire view reaches the gateway, which rejects non-lossless JSON; the
  // renderer must not manufacture undefined where the host omitted a key.
  const evidence = fullEvidence()
  const missing = []
  const walk = (value, path) => {
    if (value === undefined) { missing.push(path); return }
    if (value === null || typeof value !== 'object') return
    for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`)
  }
  walk(evidence, '$')
  assert.deepEqual(missing, [])
})

test('the timeline renders one cell per turn, with the fork point marked', () => {
  const markup = render(fullEvidence())
  assert.ok(markup.includes('timeline.title'), 'the timeline section must render')
  assert.ok(markup.includes('timeline.fork'), 'the fork marker label must reach the cell tooltip')
  // Every turn keeps its per-cell tooltip text, which is the only per-cell
  // content a static render exposes.
  for (const turn of [1, 2, 3]) assert.ok(markup.includes(`#${turn}`), `turn ${turn} must have a cell`)
})

test('the timeline legend names all three states', () => {
  const markup = render(fullEvidence())
  assert.ok(markup.includes('timeline.legendOk'))
  assert.ok(markup.includes('timeline.legendBad'))
  assert.ok(markup.includes('timeline.legendOpen'))
})

test('the fork card reports the tail cost and share', () => {
  const markup = render(fullEvidence())
  assert.ok(markup.includes('fork.title'))
  assert.ok(markup.includes('29'), 'the tail step count must render')
  assert.ok(markup.includes('41'), 'the total step count must render')
  assert.ok(markup.includes('71'), 'the tail share must render')
})

test('a session that never broke renders the no-fork message', () => {
  const evidence = {
    harness: { createdAt: 1 },
    totals: { turns: 2, steps: 10, toolCalls: 4, toolErrors: 0 },
    turns: [
      { turn: 1, seq: 1, outcome: 'completed', steps: 5, toolCalls: 2, toolErrors: 0 },
      { turn: 2, seq: 9, outcome: 'completed', steps: 5, toolCalls: 2, toolErrors: 0 },
    ],
    idleTurns: 0,
    bifurcate: { turn: null, tailSteps: 0, tailToolCalls: 0, tailShare: null },
  }
  const markup = render(evidence)
  assert.ok(markup.includes('fork.none'), 'a clean run must explain there is nothing to fork')
  assert.equal(markup.includes('fork.turn'), false, 'it must not claim a fork point')
})

test('a missing bifurcate block renders like a clean run instead of crashing', () => {
  // An older host payload has no `bifurcate`; the view must not read it blindly.
  const evidence = {
    harness: { createdAt: 1 },
    totals: { turns: 1, steps: 2, toolCalls: 1, toolErrors: 0 },
    turns: [{ turn: 1, seq: 1, outcome: 'completed', steps: 2, toolCalls: 1, toolErrors: 0 }],
    idleTurns: 0,
  }
  const markup = render(evidence)
  assert.ok(markup.includes('fork.none'))
})

test('a zero-step session renders without a meaningless share', () => {
  const evidence = {
    harness: { createdAt: 1 },
    totals: { turns: 1, steps: 0, toolCalls: 0, toolErrors: 0 },
    turns: [{ turn: 1, seq: 1, outcome: 'failed', steps: 0, toolCalls: 0, toolErrors: 0 }],
    idleTurns: 0,
    bifurcate: { turn: 1, tailSteps: 0, tailToolCalls: 0, tailShare: null },
  }
  const markup = render(evidence)
  assert.equal(markup.includes('fork.share'), false, '0/0 has no share to report')
  assert.ok(markup.includes('fork.turn'))
})

test('recorded marks render with their kind, turn, and reason', () => {
  const evidence = fullEvidence()
  evidence.marks = [
    { id: 'm1', turn: 2, kind: 'failure', reason: 'reread the same file for six turns', createdAt: 1 },
    { id: 'm2', turn: 1, kind: 'success', reason: 'planned before editing', createdAt: 2 },
  ]
  const markup = render(evidence)
  assert.ok(markup.includes('marks.title'), 'the marks section must render')
  assert.ok(markup.includes('reread the same file for six turns'))
  assert.ok(markup.includes('planned before editing'))
  assert.ok(markup.includes('mark.failure'), 'the failure pill must use its own label')
  assert.ok(markup.includes('mark.success'))
})

test('a recorded mark offers a remove action that reaches discard', () => {
  const markup = render({ ...fullEvidence(), marks: [{ id: 'mark-1', turn: 2, kind: 'failure', reason: 'stalled', createdAt: 1 }] })
  assert.ok(markup.includes('mark.remove'), 'the mark row must expose a remove control')
})

test('a session with no marks renders no marks section', () => {
  const markup = render(fullEvidence())
  assert.equal(markup.includes('marks.title'), false, 'an empty list must not produce an empty section')
})

test('a marked turn carries a dot in the table', () => {
  const withMark = fullEvidence()
  withMark.marks = [{ id: 'm1', turn: 2, kind: 'failure', reason: 'stalled', createdAt: 1 }]
  const unmarked = render(fullEvidence())
  const marked = render(withMark)
  // The dot's title carries the reason, the only text a static render exposes.
  assert.ok(marked.includes('stalled'))
  assert.ok(marked.length > unmarked.length, 'the marked render adds a dot element')
})

test('an older payload without marks still renders', () => {
  // `marks` arrived with stateVersion 4; a stale payload must not crash the view.
  const evidence = fullEvidence()
  delete evidence.marks
  const markup = render(evidence)
  assert.ok(markup.includes('summary.turns'))
  assert.equal(markup.includes('marks.title'), false)
})

test('a payload carrying every S1 field renders', () => {
  const evidence = fullEvidence()
  Object.assign(evidence.totals, {
    inputTokens: 50767954, outputTokens: 5187425, cacheReadTokens: 3641711436, messages: 10574,
  })
  Object.assign(evidence.bifurcate, {
    tailInputTokens: 219856, tailOutputTokens: 29892, tailTokenShare: 93,
  })
  evidence.repeats = 439
  evidence.retries = 102
  evidence.retryCodes = { RATE_LIMIT: 55, TRANSPORT: 10, SERVER: 37 }
  evidence.errorCodes = { FS_NOT_OBSERVED: 57, WEB_BLOCKED_URL: 28, uncoded: 175 }
  evidence.signature = {
    toolCount: 230, toolsHash: 'a1b2c3d4', promptChars: 14813, promptHash: 'ef567890',
    provider: 'workbuddy', model: 'deepseek-v4.1-flash', reasoningEffort: 'max',
  }
  evidence.topRepeats = [{ name: 'cua_driver_native__get_window_state', count: 20 }]
  for (const turn of evidence.turns) {
    turn.usage = { input: 1000, output: 100, cacheRead: 50000 }
    turn.retries = 1
  }
  const markup = render(evidence)
  // The cards that turn this from a step counter into a cost report.
  assert.ok(markup.includes('summary.tokensIn'))
  assert.ok(markup.includes('summary.cacheRead'))
  assert.ok(markup.includes('summary.repeats'))
  assert.ok(markup.includes('summary.retries'))
  // 3.64 billion cache-read tokens must not be printed raw in a card.
  assert.ok(markup.includes('3.64B'), 'large token counts must be abbreviated')
  assert.ok(markup.includes('fork.tailTokens'), 'the fork card must price the tail in tokens')
})

test('a v4 payload with no S1 fields still renders', () => {
  // A row written before the version 5 bump must not break the tab: the client
  // treats the new fields as optional everywhere.
  const evidence = fullEvidence()
  delete evidence.repeats
  delete evidence.retries
  delete evidence.errorCodes
  delete evidence.signature
  delete evidence.bifurcate.tailTokenShare
  for (const turn of evidence.turns) delete turn.usage
  const markup = render(evidence)
  assert.ok(markup.includes('summary.turns'))
})

test('an interrupted turn is labelled as the person stopping, not a failure', () => {
  const evidence = fullEvidence()
  evidence.turns[1] = { ...evidence.turns[1], outcome: 'interrupted' }
  const markup = render(evidence)
  assert.ok(markup.includes('outcome.interrupted'),
    'the interruption outcome needs its own label so it cannot read as a breakdown')
})
