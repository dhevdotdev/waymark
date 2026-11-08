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

macOS throttles timers and animation frames in windows that are hidden or covered. A run that times out while other windows cover it is inconclusive, so run it again with nothing in front before treating it as a failure.

To run a single mode against an existing build, use `node tests/native/run.mjs read`.

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
