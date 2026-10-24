# Candidate 1 — GUI observation discipline

The first S3 experiment. Scope is deliberately narrow: **one new skill file**,
because a skill is read from disk on every call, so a wrong edit costs one
prompt and reverts in seconds.

## The evidence this is grounded in

From the session logs on this machine (151 sessions, 30 of which contain any
repeated call, 445 repeated calls total):

| Session | Repeats | Calls | Worst single call |
|---|---|---|---|
| `5385a32d` | 96 | 206 | `cua_driver_native__get_window_state` ×20 with identical arguments |
| `5912f181` | 81 | 646 | `cua_driver_native__hotkey` ctrl+r ×15 |
| `ed6c5edd` | 65 | 578 | `cua_driver_native__hotkey` ctrl+r ×12 |

The literal calls, from `5385a32d`:

```
20x  cua_driver_native__get_window_state {"include_accessibility_tree":false,"pid":23384,"window_id":14749496}
19x  cua_driver_native__get_window_state {"include_accessibility_tree":false,"pid":42264,"window_id":4129018}
17x  cua_driver_native__get_window_state {"include_accessibility_tree":false,"pid":64088,"window_id":3278370}
16x  cua_driver_native__press_key          {"delivery_mode":"foreground","key":"return","pid":23384,"window_id":14749496}
12x  cua_driver_native__press_key          {"delivery_mode":"foreground","key":"return","pid":64088,"window_id":3278370}
```

## What that pattern means

The same window is captured twenty times with byte-identical arguments. Reading
it as "retry did not improve" is wrong: an error-then-retry pattern would change
arguments or tool. This is a *re-observation*: the agent looked again without
any reason to believe the screen had changed.

Four of the six top offenders are `cua_driver_native__*`; no skill on this
machine says anything about GUI observation. The agent follows no rule here
because none exists.

## The hypothesis, stated so it can fail

> A GUI session that states, up front, when NOT to re-observe — same window,
> same arguments, no intervening action — will issue fewer repeated
> `get_window_state` / `press_key` calls, without spending more tokens.

## The metric, named before measuring

- **Primary**: repeated `cua_driver_native__*` calls per session (`repeats` from
  `harnessEvidence`, restricted to the `cua_driver_native__` prefix).
- **Guard**: `inputTokens` must not rise. A guidance that fixes repeats by
  making every call more expensive is not a win.
- **Sample**: at least 3 sessions each side. One session is noise: the same task
  run twice differs by tens of percent.

## Why this candidate and not the bigger one

`FS_NOT_OBSERVED` (57 occurrences) is the largest single error class, but its fix
touches tool guidance, which every call pays for. The repeat metric is cleaner to
attribute and the change surface is one file. Prove the loop here first.
