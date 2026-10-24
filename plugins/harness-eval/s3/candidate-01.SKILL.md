---
name: gui-observation
description: Use when driving a desktop GUI through the cua_driver_native tools (get_window_state, click, press_key, type_text, hotkey). Covers when a screen capture is worth taking and when re-taking it is wasted work.
---

# GUI observation discipline

A screenshot is evidence about a moment. Once you have it, it does not go stale
unless something changed. Most wasted work in GUI sessions is not a failed
action — it is capturing the same window again for no reason.

## Take a capture when

- You do not yet have a capture of this `pid` + `window_id` in this turn.
- You performed an action that was supposed to change what is on screen: a
  click, a key, a navigation, a scroll that moved content.
- The previous action returned an error you cannot explain, and the screen may
  reflect a partial effect.

## Do not capture again when

- You already have a capture of the same `pid` + `window_id`, at the same
  scroll position, with **no intervening action**. Re-taking it returns the same
  pixels; you are paying tokens to learn nothing.
- You are checking whether an action worked. Use its return value first. A
  `click` that reports success on a resolved element did not silently fail;
  re-reading the window to confirm is the single most common wasted capture.
- You are deciding what to do next and already have the tree. Reread the capture
  you have — it is still in your context.

## The specific trap this exists to stop

Repeating `get_window_state` with **identical arguments** several times in a row,
while nothing acted on the window in between. Observed on this machine: the same
window captured 20 times in one session, same `pid`, same `window_id`, same
`include_accessibility_tree`. That is 20 paid observations of one unchanged
image.

If you find yourself about to call `get_window_state` with arguments identical
to a call you already made and nothing happened in between, stop: you have the
answer already.

## Keys are not idempotent — check the state, do not re-send

Repeating `press_key` or `hotkey` with the same arguments is worse than a wasted
capture: the screen HAS changed, so the second send acts on a different state
than the first.

- After sending `return`, do not send `return` again simply because the expected
  transition has not appeared yet. If the first one worked, a second submits
  whatever now has focus. Read the window first if you are unsure.
- `ctrl+r`, `ctrl+s`, `f5`, and similar accelerators trigger their action every
  time they are sent. Sending one twice is a second reload or a second save, not
  a retry.
- A key that appeared to do nothing is more often a focus problem than a
  delivery problem. Check which window has focus (`get_window_state` on the
  target `pid`) before sending it again.

## Batching

Several reads of one window are usually one question: "what is on this screen?"
Ask it once. If you need two properties, use one call that returns both rather
than two calls that each return nearly the same thing.

## What this does not say

This is about not paying twice for the same observation. It is not a budget on
captures: when the screen genuinely changed, or when an error left you unsure
what happened, capture again. Evidence beats a saved token.
