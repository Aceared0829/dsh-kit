# Vendored code

Both files in this directory are **verbatim copies**, not a fork. They are here
because this plugin must keep working when the source package is not installed,
and because they are the only two of its 56 modules that qualify: each imports
nothing but Node builtins, and `capabilities.js` adds a single sibling import.

| File | Upstream | Size |
|---|---|---|
| `session-usage.js` | `@modusensus/dsh-mneme` 0.9.1 `lib/session-usage.js` | 16,178 bytes |
| `capabilities.js` | `@modusensus/dsh-mneme` 0.9.1 `lib/capabilities.js` | 38,835 bytes |

Upstream: <https://github.com/slow-stack/mneme> — MIT, Copyright (c) the mneme
authors. The upstream LICENSE text is not duplicated here; see that repository.

## What this copy is for

`session-usage.js` decompresses the frame-per-line session log. That is the one
genuinely hard thing in this area: `zlib.zstdDecompressSync` returns only the
FIRST frame of a multi-frame buffer and does not throw, so a naive read silently
drops almost the whole file. This module splits on the frame magic first.

`reader.js` in `src/` re-implements the same frame splitting independently, and
`verify.mjs` cross-checks the two. If they ever disagree, the vendored copy is
the reference.

## Maintenance

**Upstream updates are deliberately not tracked.** This plugin is now the owner
of these two files. Before editing either one:

1. Copy the upstream `lib/` version aside.
2. Make the change.
3. Re-run `npm test` and `node verify.mjs` against real session data; frame
   counts must match what the projection folded.

Do not add new files here without the same justification: builtins-only imports
and a measurable capability this plugin cannot get elsewhere.
