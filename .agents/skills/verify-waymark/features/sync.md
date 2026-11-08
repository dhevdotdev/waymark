# Sync and history

## Sub-features

Status bar, fetch and fast-forward, refusal when diverged or blocked, file history in Info, commit and push.

## How to get to it (user POV)

The status bar shows state. ⌘⇧S syncs. ⌘⇧Y opens the panel. Inspector, Info lists the note's commits.

## Driving it with the self-test

`node tests/native/run.mjs git diverged blocked`. Each mode builds a disposable repository with a real bare remote. Checks live in `src/selftest.ts`.

## Gotchas

The browser preview shows "Preview" and has no Git, so it proves nothing here. Real private-remote authentication has no automated coverage. A covered window can throttle the run and cause a timeout, which counts as inconclusive.
