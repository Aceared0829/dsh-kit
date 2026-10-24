# dsh-harness-eval

English | 中文

A `Harness` tab in every session's conversation view: where an attempt broke
down, what it cost, and what the retry looked like.

Status: **S1 (observation layer)**. The host half folds real session events
into the `harnessEvidence` projection and stores marks durably; the browser
half renders both.

## What S1 added

| Evidence | Source event | Why it matters |
|---|---|---|
| Token cost per session and per turn | `assistant/message.usage` | "How much would a re-run cost" is a token question, not a step question |
| Fork point = first REAL breakdown | `turn/end.reason` | A turn the person interrupted is not a failure; counting it as one inflated every fork estimate by ~46% |
| Error codes | `tool/result.error.code` | Separates "did not read before writing" from "network blocked" |
| Transport retries | `llm/retry` | A transport hiccup says nothing about the agent's competence |
| Repeat fingerprints | `tool/call` name + arguments | The "experience did not accumulate" signal |
| Harness signature | `request/header` + `system/message` | Without it two runs cannot be compared at all |

### Numbers this is validated against

On this machine's real data (144 session logs, 76,877 events):

- two independent readers agree on every log (`npm run verify -- --readers`)
- `repeats` = 439, matching an independent hand count exactly
- `retries` = 102, matching exactly
- the fork count drops from 37 sessions to 21 once interruptions are excluded

## Install

```sh
dsh plugin --profile desktop add link:<本库路径>\plugins\harness-eval
```

The running instance must restart: the profile loads `lib/`, which lives under
`node_modules` through the `link:` dependency, and HMR ignores `node_modules`
by default.

## Verify

```sh
cd plugins/harness-eval
npm test         # unit + bundle contract tests
npm run gate     # PRE-RESTART GATE: fold + wire + render on real sessions
npm run verify   # both readers cross-check + is the projection mounted?
npm run export   # one JSONL row per Session, refolded from the logs
```

### The pre-restart gate

**Never ask for a restart until `npm run gate` passes.** Unit tests run against
hand-built fixtures; this runs the three stages the product actually runs,
against every real session log on the machine:

1. **Host fold** — fold each log, then push through `stateSchema` and
   `wire.view`. A throw here fails that session's whole projection, which is how
   this plugin once made session history unreadable.
2. **Wire transport** — every view must survive a lossless JSON round trip and
   carry no `undefined`. A rejection here rolls back the entire new Session,
   which is how this plugin once made the composer unavailable.
3. **Browser render** — the real `lib/client.js` renders every real payload
   through `renderToStaticMarkup`. A throw here is a blank tab.

It also enforces a **state size budget** (default 128 KB per session): the
projection row is written to the cache on every change, so a bloated row makes
long sessions progressively slower. This budget caught a real regression where
storing raw tool arguments in the repeat map produced a 470 KB row; the map now
stores a hash and the same session is 20 KB.

The gate was mutation-tested: injecting `undefined` into the view, throwing from
the fold, and throwing from render each make it fail with the offending session
named.

`npm run verify -- --readers` runs the cross-check alone: `vendor/session-usage.js`
and `lib/reader.js` must decode every log to the same event count. A
disagreement means one of them is losing frames, which is the failure vendoring
exists to prevent.

`npm run export` **refolds from the session logs** rather than reading the
projection cache. The cache only holds sessions that were live in this process
and its rows expire when `stateVersion` changes; the logs are the durable
record. `--from-cache` keeps the old path for A/B checking.

## Layout

| Path | Role |
|---|---|
| `src/evidence.js` | The fold. Shared by the host projection, the exporter, and the verifier, so all three compute the same numbers. |
| `src/reader.js` | Frame-accurate session log decoder (zstd is frame-per-line). |
| `vendor/session-usage.js` | Verbatim copy from `@modusensus/dsh-mneme` 0.9.1; the independent reader the cross-check compares against. See `vendor/NOTICE.md`. |
| `src/index.js` | Host source: the projection unit and marks-service mount. Copy to `lib/`. |
| `src/marks-service.ts` | Host source: the `harnessMarks` Remote service. Compile. |
| `src/marks.js` | The `harness_marks` storage domain. Copy to `lib/`. |
| `src/remote-spec.js` | Remote descriptor spec. Copy to `lib/typert.remote-client.js`. |
| `lib/index.js` | Deployed host half. Must match `src/index.js`. |
| `lib/evidence.js` | Deployed fold. Must match `src/evidence.js`. |
| `lib/reader.js` | Deployed reader. Must match `src/reader.js`. |
| `lib/marks-service.js` | Compiled from `src/marks-service.ts`. |
| `lib/marks.js` | Deployed domain. Must match `src/marks.js`. |
| `lib/typert.remote-client.js` | Deployed spec. Must match `src/remote-spec.js`. |
| `lib/client.js` | Browser half, hand-written in the `tsdown` output shape. |
| `test.mjs` | Unit tests for the fold and the wire view. |
| `marks.test.mjs` | Schema tests for the mark record. |
| `client.test.mjs` | Bundle-shape, slot, dictionary, and render tests. |
| `remote-spec.test.mjs` | Drift guard: spec endpoints versus `@Remote` methods. |
| `deploy.test.mjs` | Deploy consistency: source/binary parity and published files. |
| `export.test.mjs` | Export: log refolding, cache path, marks merge, JSONL. |
| `verify.mjs` | Two readers must agree, and the projection must be mounted. |
| `export.mjs` | Durable evidence → JSONL exporter. |

## Build

```sh
cd plugins/harness-eval
npm run build    # src/marks-service.ts -> lib/marks-service.js
```

The host entry, marks domain, and Remote spec are copied, not compiled:

```sh
cp src/index.js lib/index.js
cp src/marks.js lib/marks.js
cp src/remote-spec.js lib/typert.remote-client.js
```

`deploy.test.mjs` byte-compares all three deployed copies with their sources.

## Export

```sh
node export.mjs                         # JSONL on stdout, summary on stderr
node export.mjs --out evidence.jsonl
node export.mjs --home <DSH_HOME> --include-empty
```

The exporter accepts only the current Session format and `harnessEvidence`
state version, renders the cached state through the plugin's own wire view,
merges marks from `storages/harness_marks.json`, and excludes cache documents
whose Session directory no longer exists. Empty Sessions are omitted unless
`--include-empty` is set. No exportable row exits non-zero, so a silent empty
file cannot be mistaken for a successful evaluation dataset.

## Why the Remote artifact is hand-written

`@deepseek-ai/dsh-typert-generator` only runs inside the repository workspace:
it locates a root holding both `tsconfig.host.json` and `packages/`, and this
plugin is a self-contained bundle under `plugins/`. What the generator emits is
a plain `createTypertRemoteInfo(spec, z)` call, so an equivalent spec written by
hand is valid input.

Host-side discovery does not use the artifact at all: `api-gateway` reflects
each Service's `typertRemote` binding and the `@Remote` metadata. The artifact
supplies the **Client** side, mounted with `ctx.remote.$mount(...)` from the
browser half.

`remote-spec.test.mjs` compares the spec's endpoints against the metadata the
service's decorators write, so a drift fails a test instead of surfacing as a
rejected call.

## Two rules this package exists to keep

**1. Projection state and wire view must be lossless JSON.**

`undefined` is not JSON. It breaks in two places, and both were observed here:

- The projection cache persists the unit's **state**. A state carrying
  `undefined` fails validation, so the row is never written.
- The wire **view** crosses the gateway, which rejects non-lossless data. A
  rejected `api-session/added` argument rolls back the entire new Session: the
  sidebar shows a row, but the composer reports `placeholder.unavailable` and
  no session can be created.

An absent optional value is therefore an **omitted key**, never
`key: undefined`. The fold uses `null` internally to mark an open turn, and the
view omits `outcome` for it.

`test.mjs` enforces this with a recursive `undefined` walk plus a JSON
round-trip on both the state and the view, across a blank session, an open
turn, and mixed turns.

**2. Deploy from `src/`, not by editing `lib/`.**

`lib/index.js` is what the profile loads. Editing only `src/` leaves the
running system on the old code; editing only `lib/` loses the change on the
next copy. Keep them byte-identical:

```sh
cmp -s src/index.js lib/index.js || cp src/index.js lib/index.js
```

## Status

| Step | Content | State |
|---|---|---|
| M0 | Bundle loads, tab appears after 看板 | done |
| M1 | Collector derives turn-level evidence | done |
| M2 | Session view: failure timeline | done |
| M3 | Marking typical failures | done |
| M4 | JSONL export | done |

## Why a hand-written bundle

`lib/client.js` is written directly in the
`window.__ModuleLoader__.load({ id, factory })` shape that `tsdown` emits for
every Client package. The factory body needs no transformation, so this package
carries no build step: editing the file is the whole loop.
