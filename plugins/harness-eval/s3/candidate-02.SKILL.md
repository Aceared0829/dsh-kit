---
name: edit-discipline
description: Use before calling edit or write on an existing file. Covers the read-first rule that these tools enforce, and what to do when a write is refused.
---

# Editing an existing file

`edit` and `write` refuse to modify a file this session has not read. The refusal
reads `file has not been read — read the file, then retry`. It is not a permission
problem and retrying the same call changes nothing.

## The rule

**Read a file before you change it.**

- `edit` needs the current text anyway: `old_string` has to match exactly what is
  on disk right now. Reading first is not overhead — it is how you learn what to
  put in `old_string`.
- `write` replaces the whole file. Without reading it first you are choosing to
  discard content you never looked at, including parts unrelated to your change.

## The order that works

```
read   <path>     → see what is there
edit   <path>     → change the part you mean
```

For a new file, `write` is correct and no read is needed: there is nothing to
observe.

## When a write is refused

The refusal means exactly one thing: this session has not read that path. Read it,
then make the same change again. Do not retry the identical call — it will be
refused identically.

If a read is impossible because the file truly does not exist, use `write` to
create it. If the read fails for another reason, fix that reason first; editing a
file you could not read means editing something you do not know the contents of.

## One read can cover several edits

Read once, then make every edit to that file. The rule is about having observed the
file, not about reading it before each call.

## Where this costs the most

Making several changes across a directory is the common failure: the first file is
read (because it was just inspected), the next three are edited from memory of a
similar file. Each of those is refused, and each refusal is a full round trip.
Read each path you intend to touch.
