# Runbook

Start with `pnpm run health`. It reports the tools, dependencies and port this checkout needs.

## A check fails

| Symptom | Likely cause | Do this |
|---|---|---|
| `cargo: command not found` | A fresh shell without Rust on its path | `source $HOME/.cargo/env` |
| `Port 5178 is in use` | A dev server is still running | Stop the server you started. `lsof -ti tcp:5178 -sTCP:LISTEN` finds it. |
| `pnpm arch` reports a file over budget | A module has grown past 650 lines | Split it along a real responsibility. Do not raise the budget. |
| `pnpm knip` reports an unused export | Code no longer has a caller | Delete it, or remove `export` if it is used locally. |
| A pre-commit hook fails | Lint, types or a staged secret | Fix the cause. Do not use `--no-verify`. |

## The native self-test

`pnpm test:native` builds the app and runs `tests/native/run.mjs`, which launches the binary four times against disposable vaults: `read`, `git`, `diverged` and `blocked`. Reports go to a temporary folder and failures are printed.

A run never takes focus and shows no window, so it can run while someone is using the Mac. The app starts with the prohibited activation policy, and WebKit's hidden-page timer throttling is turned off, so timings stay real. A page that is never drawn gets no animation frames, no CSS animations and no editor measuring, so the few checks that need them are reported as inconclusive rather than passed.

When the Mac has had no keyboard or pointer input for five minutes (`HIDIdleTime`), or with `--drawn`, the runner asks for a drawn page instead. The window is transparent, takes no clicks and floats above the others, so nothing can cover it, and every check runs. Putting it up can activate the app, which is why it waits for idle.

The `quit` mode types into a note, then sends the quit Apple event to the app's pid, as the Dock and logout do, and fails unless the edit is on disk within 8 seconds.

To run a single mode against an existing build, use `node tests/native/run.mjs read`, or `node tests/native/run.mjs read --drawn` to run every check now.

## Reading a problem report

- Preferences: `~/Library/Application Support/dev.dhev.folio/preferences.json`. A file that cannot be parsed is moved to `preferences.json.corrupt`, and the app starts with defaults.
- Git failures reach the status bar with credentials removed. Run the same command in Terminal inside the vault to see the raw output.
- The app makes no network requests of its own apart from Git. If one appears, treat it as a bug in `src/render/sanitize.ts` or the CSP in `src-tauri/tauri.conf.json`.

## Installing a build

```sh
pnpm tauri build --bundles app
cp -R src-tauri/target/release/bundle/macos/Waymark.app /Applications/
```

The build is unsigned and runs on the Mac that built it.

## Rolling back

`git log` shows what changed. Check out the earlier commit, rebuild, and reinstall. Preferences are forward-compatible: unknown or malformed keys fall back to their defaults.
