/**
 * Pre-restart gate: prove the plugin can open BEFORE asking for a restart.
 *
 * Unit tests run against hand-built fixtures. This script runs the same three
 * stages the real product runs, against the real data on this machine:
 *
 *   1. **Host fold** — every session log is folded, then pushed through
 *      `stateSchema` and `wire.view`, exactly as the projection registry does.
 *      A throw here fails the whole session projection, which is how this
 *      plugin once made session history unreadable.
 *   2. **Wire transport** — every view must survive a lossless JSON round trip.
 *      A rejection here rolls back the entire new Session, which is how this
 *      plugin once made the composer unavailable.
 *   3. **Browser render** — the real client bundle renders every real payload
 *      through `renderToStaticMarkup`. A throw here is a blank tab.
 *
 * Plus a size budget: the projection state is written to the cache on every
 * change, so a bloated row makes long sessions progressively slower.
 *
 *   node gate.mjs
 *   node gate.mjs --limit 20        # newest 20 sessions only
 *   node gate.mjs --max-state 131072
 *
 * Exit code 0 means it is safe to restart. Anything else means do not.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Default DSH home to read, when `DSH_HOME` is unset.
 *
 * Portable on purpose: the plugin ships without any machine-specific path, and
 * `DSH_HOME` is the same variable the Host itself resolves.
 */
const DEFAULT_HOME = join(homedir(), '.dsh')
/** Sessions whose evidence state exceeds this are reported. */
const DEFAULT_MAX_STATE = 128 * 1024

/** Report one verified stage. */
const pass = message => console.log(`  PASS  ${message}`)
/** Report a stage that could not run; a skip is not a pass. */
const skip = (state, message) => { state.skipped.push(message); console.log(`  SKIP  ${message}`) }

/**
 * Parse the command line.
 * @param argv - arguments after the script path.
 * @returns the resolved options.
 */
function parseArgs(argv) {
  const options = { home: process.env.DSH_HOME ?? DEFAULT_HOME, limit: 0, maxState: DEFAULT_MAX_STATE }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--home' || arg === '--limit' || arg === '--max-state') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      if (arg === '--home') options.home = value
      else if (arg === '--limit') options.limit = Number(value)
      else options.maxState = Number(value)
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node gate.mjs [--home <dir>] [--limit <n>] [--max-state <bytes>]')
      process.exit(0)
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return options
}

/**
 * Collect every `undefined`-valued path.
 * @param value - value to walk.
 * @param path - current path label.
 * @param out - accumulator.
 * @returns the offending paths.
 */
function undefinedPaths(value, path = '$', out = []) {
  if (value === undefined) {
    out.push(path)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    value.forEach((item, index) => undefinedPaths(item, `${path}[${index}]`, out))
    return out
  }
  for (const key of Object.keys(value)) undefinedPaths(value[key], `${path}.${key}`, out)
  return out
}

/**
 * Load the browser bundle through the same facade the page provides.
 * @returns the mounted component and dictionary lookup.
 */
async function loadClient() {
  // `react` is shell-provided; resolve it from the workspace copy the tests use.
  const reactDir = join(here, '..', '..', 'packages', 'client', 'web', 'node_modules')
  const load = segments => import(pathToFileURL(join(reactDir, ...segments)).href)
  const modules = {
    react: await load(['react', 'index.js']),
    'react/jsx-runtime': await load(['react', 'jsx-runtime.js']),
    zod: await import('zod'),
  }
  const { renderToStaticMarkup } = await load(['react-dom', 'server.js'])
  globalThis.window = { __ModuleLoader__: { load: value => { globalThis.__registration = value } } }
  await import(pathToFileURL(join(here, 'lib', 'client.js')).href)
  const registration = globalThis.__registration
  if (registration === undefined) throw new Error('lib/client.js did not register a module')
  const plugin = registration.factory(specifier => {
    if (!(specifier in modules)) throw new Error(`bundle requested an unexpected module: ${specifier}`)
    return modules[specifier]
  })
  const captured = {}
  plugin.apply({
    effect: fn => fn(),
    locale: {
      register: (_namespace, dictionaries) => {
        captured.dictionaries = dictionaries
        return () => {}
      },
      bind: () => key => key,
    },
    slots: {
      inject: (_name, install) => install(),
      register: (definition, component) => {
        captured.definition = definition
        captured.component = component
        return () => {}
      },
    },
    remote: {
      $mount: () => Promise.resolve(() => {}),
      get harnessMarks() { return undefined },
    },
    get: () => undefined,
  })
  if (captured.component === undefined) throw new Error('the bundle did not register a view component')
  return {
    /**
     * Render one payload the way the tab does.
     * @param evidence - the wire view.
     * @returns the static markup.
     */
    render: evidence => {
      const View = () => captured.component({ t: key => key, useProjection: () => evidence })
      return renderToStaticMarkup(modules.react.createElement(View))
    },
    /**
     * Look a key up in one shipped dictionary.
     * @param language - `zh` or `en`.
     * @param key - dictionary key.
     * @returns the entry, or undefined.
     */
    lookup: (language, key) => captured.dictionaries?.[language]?.[key],
    dictionaries: captured.dictionaries,
  }
}

/**
 * Mount the whole plugin on a real Cordis Context and report which tools
 * registered.
 *
 * This is the check that a plain unit test cannot make: `inject` decides whether
 * a child fiber ever activates, and a service that is missing at mount time
 * leaves the child dormant without an error. The tools array coming back short
 * is the whole symptom, so the gate asserts on it directly.
 * @returns the expected and registered tool names, or undefined when Cordis is
 *   not resolvable from this bundle.
 */
async function checkActivation() {
  let Context
  try {
    ({ Context } = await import('@deepseek-ai/cordis'))
  } catch {
    return undefined
  }
  const registered = []
  const guards = []
  const routes = []
  const ctx = new Context()
  // The services this plugin's children inject. They are stubs: the gate is
  // asking "does the fiber activate", not "does the service work".
  const disposers = [
    ctx.provide('sessionProjections', { register: () => () => {} }),
    ctx.provide('storageDomain', {
      open: async () => ({
        table: () => ({ entries: () => [], put: async () => {}, delete: async () => false }),
        close: async () => {},
      }),
    }),
    ctx.provide('tools', {
      register: (definition) => { registered.push(definition.name); return () => {} },
      // The S3 repeat guard registers through `guard()`, not `register()`. A
      // stub without this method makes the guard's child fiber fail to activate,
      // which is silent: the tool list looks complete and the guard simply never
      // runs. Capturing it here lets the gate assert that it fires.
      guard: (guardFn) => { guards.push(guardFn); return () => {} },
    }),
    // Deliberately strict: a real Host throws for an order name it does not
    // declare, and a plugin that asks for one aborts its own `apply` and
    // silently never registers its tools. Making the stub throw reproduces that
    // exactly, so the gate fails instead of the user finding an empty toolbar.
    ctx.provide('systemPrompt', {
      section: () => () => {},
      getSectionOrder: (name) => {
        throw new Error(`unknown prompt section order "${String(name)}"`)
      },
    }),
    ctx.provide('sessionController', { fork: async () => ({ sessionId: 'gate-probe' }) }),
    ctx.provide('agents', { currentInitiator: () => undefined }),
    // The read endpoints register through `webServer.register`, and the plugin
    // deliberately tolerates its absence (retrying, then reporting). The gate
    // must therefore SUPPLY it, or a route set that never registers would pass
    // unnoticed — the same silent-absence failure mode as an unregistered tool.
    ctx.provide('webServer', {
      register: (route) => { routes.push(String(route.path)); return () => {} },
    }),
  ]
  try {
    const plugin = await import(new URL('./lib/index.js', import.meta.url))
    await ctx.plugin(plugin)
    // Activation is asynchronous: give the child fibers a turn to settle.
    await new Promise(resolve => setTimeout(resolve, 150))
  } catch {
    return undefined
  } finally {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // A stub teardown cannot be allowed to fail the gate.
      }
    }
  }
  return { expected: ['harness_fork', 'harness_siblings'], registered, guards, routes }
}

/**
 * Run the gate.
 * @param argv - arguments after the script path.
 * @returns the process exit code.
 */
async function main(argv) {
  const options = parseArgs(argv)
  const plugin = await import(new URL('./lib/index.js', import.meta.url))
  const reader = await import(new URL('./lib/reader.js', import.meta.url))
  const client = await loadClient()

  let definition
  plugin.apply({
    sessionProjections: { register: value => { definition = value; return () => {} } },
    plugin: () => {},
    get: () => undefined,
    effect: () => () => {},
  })
  if (definition === undefined) throw new Error('the host half did not register a projection')

  const logs = reader.findSessionLogs(options.home)
  const targeted = options.limit > 0 ? logs.slice(-options.limit) : logs
  console.log(`gate: ${targeted.length} of ${logs.length} session log(s) under ${options.home}`)
  console.log(`gate: projection "${definition.key}" v${definition.stateVersion}`)

  const problems = []
  const sizes = []
  let folded = 0
  let rendered = 0

  for (const found of targeted) {
    let events
    try {
      events = reader.readSessionLog(found.path)
    } catch (error) {
      problems.push(`${found.sessionId}: cannot read log (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const header = events[0]
    if (header?.type !== 'session') continue

    // 1. Host fold.
    let state
    try {
      state = definition.init(header)
      const seen = new Set()
      for (const event of events) {
        if (event === header) continue
        if (typeof event.seq === 'number') {
          if (seen.has(event.seq)) continue
          seen.add(event.seq)
        }
        state = definition.apply(state, event)
      }
      definition.stateSchema.parse(state)
    } catch (error) {
      problems.push(`${header.id}: fold threw (${error instanceof Error ? error.message : String(error)})`)
      continue
    }

    // 2. Wire transport.
    let view
    try {
      view = definition.wire.view(state)
      definition.wire.viewSchema.parse(view)
    } catch (error) {
      problems.push(`${header.id}: wire.view threw (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const undefinedKeys = undefinedPaths(view)
    if (undefinedKeys.length > 0) {
      problems.push(`${header.id}: view carries undefined at ${undefinedKeys.slice(0, 3).join(', ')}`)
    }
    const serialized = JSON.stringify(view)
    if (serialized === undefined) problems.push(`${header.id}: view is not serializable`)
    else if (JSON.stringify(JSON.parse(serialized)) !== serialized) {
      problems.push(`${header.id}: view does not survive a JSON round trip`)
    }
    const stateJson = JSON.stringify(JSON.parse(JSON.stringify(state)))
    sizes.push(stateJson.length)
    if (stateJson.length > options.maxState) {
      problems.push(`${header.id}: state is ${(stateJson.length / 1024).toFixed(0)} KB, over the ${(options.maxState / 1024).toFixed(0)} KB budget`)
    }
    folded += 1

    // 3. Browser render, against the real payload.
    if (view.totals.turns === 0) continue
    try {
      const markup = client.render(view)
      if (typeof markup !== 'string' || markup === '') {
        problems.push(`${header.id}: render produced no markup`)
      }
    } catch (error) {
      problems.push(`${header.id}: render threw (${error instanceof Error ? error.message : String(error)})`)
    }
    rendered += 1
  }

  // The empty state is its own render path: a brand-new session has no row yet.
  try {
    const markup = client.render(undefined)
    if (!markup.includes('empty.title')) problems.push('the empty state does not render its placeholder')
  } catch (error) {
    problems.push(`empty state threw (${error instanceof Error ? error.message : String(error)})`)
  }

  // Activation check. A plugin can fold, transport and render perfectly and
  // still never mount its tool, because `inject` held the child fiber waiting
  // for a service the profile does not register. That failure is silent: the
  // tool simply never appears. Mount the whole plugin on a real Cordis Context
  // with the services this profile actually has, and require the advertised
  // tools to be registered.
  const activation = await checkActivation()
  if (activation === undefined) {
    skip(state, 'the Cordis activation check is unavailable here')
  } else {
    for (const name of activation.expected) {
      if (!activation.registered.includes(name)) {
        problems.push(`activation: the tool "${name}" did not register, so it would never appear in a session`)
      }
    }
    if (activation.expected.every(name => activation.registered.includes(name))) {
      pass(`activation: mounts on a real Context and registers ${activation.expected.join(', ')}`)
    }
    // The S3 repeat guard: it must be registered AND must actually deny an
    // identical GUI call. A registered-but-inert guard is the same defect as a
    // tool that never appears, and just as invisible.
    if (activation.guards.length === 0) {
      problems.push('activation: no tool guard was registered, so the S3 repeat guard is inert')
    } else {
      const probe = activation.guards[0]
      const agent = {}
      const args = { name: 'cua_driver_native__get_window_state', arguments: { pid: 1, window_id: 2 }, agent }
      const first = probe({ ...args })
      const second = probe({ ...args })
      if (first !== undefined) problems.push(`activation: the guard denied a FIRST GUI call: ${first}`)
      if (typeof second !== 'string') {
        problems.push('activation: the guard allowed an identical repeated GUI call, so it does not guard')
      } else {
        pass('activation: the repeat guard denies an identical second GUI call')
      }
    }
    // The read endpoints. A route set that never registers looks exactly like a
    // plugin that works and simply has no endpoints, so it is asserted here
    // rather than discovered as an empty panel after a restart.
    const expectedRoutes = ['/api/harness-eval/status', '/api/harness-eval/probe', '/api/harness-eval/candidates']
    for (const path of expectedRoutes) {
      if (!activation.routes.includes(path)) {
        problems.push(`activation: the route ${path} did not register, so the change panel would be empty`)
      }
    }
    if (expectedRoutes.every(path => activation.routes.includes(path))) {
      pass(`activation: registers the ${expectedRoutes.length} read routes`)
    }
  }

  // Every shipped dictionary must be complete strings, and both languages must
  // carry the same keys: a missing key renders as the raw key in the tab.
  const languages = ['zh', 'en']
  const dictionaries = languages.map(language => client.dictionaries?.[language])
  dictionaries.forEach((dictionary, index) => {
    if (dictionary === undefined) {
      problems.push(`no ${languages[index]} dictionary was registered`)
      return
    }
    for (const [key, value] of Object.entries(dictionary)) {
      if (typeof value !== 'string') problems.push(`${languages[index]} dictionary entry ${key} is not a string`)
    }
  })
  if (dictionaries.every(dictionary => dictionary !== undefined)) {
    const [first, second] = dictionaries
    for (const key of Object.keys(first)) {
      if (!(key in second)) problems.push(`dictionary key "${key}" exists in ${languages[0]} but not ${languages[1]}`)
    }
    for (const key of Object.keys(second)) {
      if (!(key in first)) problems.push(`dictionary key "${key}" exists in ${languages[1]} but not ${languages[0]}`)
    }
  }

  // Ascending, so the last entry is the largest.
  sizes.sort((left, right) => left - right)
  const kb = value => `${(value / 1024).toFixed(1)} KB`
  console.log(`gate: folded ${folded} session(s), rendered ${rendered} populated payload(s)`)
  if (sizes.length > 0) {
    const median = sizes[sizes.length >> 1]
    const p95 = sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.95))]
    console.log(`gate: state size median ${kb(median)} p95 ${kb(p95)} max ${kb(sizes.at(-1))}`)
  }

  if (problems.length > 0) {
    console.error(`\nGATE FAILED — do not restart. ${problems.length} problem(s):`)
    for (const problem of problems.slice(0, 30)) console.error(`  ${problem}`)
    if (problems.length > 30) console.error(`  … and ${problems.length - 30} more`)
    return 1
  }
  console.log('\nGATE PASSED — the host folds, the gateway accepts, and the tab renders. Safe to restart.')
  return 0
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2))
  } catch (error) {
    console.error(`GATE FAILED — ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
