---
name: verify-waymark
description: Launch, drive and prove behaviour in Waymark, the Mac Markdown reader. Use to see a change working in the real UI, to reproduce a reading, navigation, graph or sync bug, or before saying a change works.
---

# Verify Waymark

Two surfaces exist. WebKit against the dev server covers reading, navigation, search and the graph. The packaged app is the only proof of anything touching Rust, IPC, Git or `vault://`, because the browser preview has no Git.

## Doctor

Run `pnpm run health` from the repository root. Every line must say `ok`. A port that is not free means a server is already running; only drive it if you started it.

## Launch

The browser harness starts its own server on a fresh fixture vault, so run nothing else first:

```js
import { webkit } from "playwright";
import { serveFixture } from "./tests/e2e/serve.mjs";
import { NOTES } from "./tests/e2e/fixture-vault.mjs";

const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
```

Ready means `metrics.indexMs` is set. Put your script in a scratch folder or the repository root, because the imports are relative.

For the packaged app, build with `pnpm tauri build --bundles app`, then run `node tests/native/run.mjs <read|git|diverged|blocked>`.

## Drive

Use what a user uses: keyboard shortcuts, clicks and the selectors below. `window.waymark.vault` and `window.waymark.open(path)` exist for setup and reading state. Do not use them as the action under test.

The feature map in `features/README.md` lists what to drive and what proves it. Drive every entry point it lists for the feature you changed.

## Evidence

Write to a scratch folder outside the repository, because screenshots can show note content and `*.png` is ignored for that reason.

- Capture the action and the resulting state, using `page.screenshot` and the DOM values you asserted.
- A claim about Git needs repository state from `git -C <vault> log` and `status`, not only what the UI says.
- `pnpm test:e2e` is the regression pin. A structural change must leave it fully green in both modes.
- A run that could not complete is inconclusive, not a pass.

## Cleanup

`await browser.close(); await app.close();` removes the server and its temporary vault. `tests/native/run.mjs` removes its own vaults. Kill only processes you started. Evidence stays in your scratch folder.

Never point any of this at a real vault that matters. The self-test writes to Git in its `git` mode, and that mode exists only for disposable fixtures.
