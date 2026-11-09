# Waymark

A Mac client for Markdown vaults kept in Git, built with Tauri 2, TypeScript and plain CSS. Notes stay ordinary files that any Markdown app can open. Waymark reads and edits them as plain text and syncs through the user's own `git`.

## Commands

| Task | Command |
|---|---|
| First setup | `pnpm bootstrap` |
| Can this checkout run? | `pnpm run health` |
| Everything that must pass before a commit lands | `pnpm check` |
| Browser preview on a vault | `WAYMARK_VAULT=/path pnpm dev` (port 5178) |
| Drive the reader in WebKit against the fixture | `pnpm test:e2e` |
| Open every fixture note, report render cost | `pnpm test:sweep` |
| Compare every surface pixel by pixel with another commit | `pnpm test:visual <ref>` |
| Build the app and run its self-test | `pnpm test:native` |
| Sign the built app and install it, keeping macOS folder permissions | `pnpm install:app` |

Rust needs `source $HOME/.cargo/env` in a fresh shell. To see a change working, follow `.agents/skills/verify-waymark/SKILL.md`.

## Hard rules

These are product promises. Do not trade them for convenience.

- Never reset, stash, rebase, force-push or merge divergent histories. Incoming commits apply only as fast-forwards. Anything else is explained and handed to the user's terminal.
- No automatic commits or pushes. Background work may only fetch.
- Never write to `.obsidian/`, ignore rules or Git config. Preferences live in the app's own support folder.
- A note changes only because the user edited it, and only through `write_note`, which refuses to replace text the user has not seen. Never add a blind overwrite. Edits must keep every byte the user did not touch, line endings included.
- Note content is untrusted. It gets no script execution, no remote loads and no filesystem access beyond the vault. Every path from the frontend goes through `src-tauri/src/vault.rs`.
- Redact credentials from anything that reaches the UI or a log.
- The app imposes no organisation. No filename, folder, heading or frontmatter key has special meaning. `aliases` is the one exception, because it is how Obsidian links resolve.
- Real notes never enter this repository, its tests or its history. Tests use the generated vault in `tests/e2e/fixture-vault.mjs`.
- Honour Reduce Motion wherever something moves, canvas included.
- No telemetry, analytics or crash reporting. Nothing leaves the machine except Git traffic the user asked for.

## Where things live

`ARCHITECTURE.md` maps the modules and how data moves. Read it before changing more than one module. `DESIGN.md` records the visual and interaction decisions, so read it before changing the UI. `GLOSSARY.md` defines the words used here. `docs/runbook.md` covers diagnosing a broken build or a failing check.

`pnpm arch` enforces layering and a 650-line file budget. Add a new top-level source folder to `LAYERS` in `scripts/check-architecture.mjs`.

## Working here

- Write the failing test first when fixing a bug. Unit tests live in `tests/unit/` and assert behaviour through public interfaces.
- `tests/e2e/reader.mjs` pins user-visible behaviour. A structural change must leave it fully green in both normal and `reduced` modes.
- A change to the Rust layer or IPC is proven only by `pnpm test:native`. A browser preview does not exercise Git or `vault://`.
- Comments state a non-obvious reason. Do not narrate the change.
- Test files are named `tests/unit/<subject>.test.ts`. Types and classes are PascalCase, functions and variables camelCase, constants SCREAMING_SNAKE_CASE. Biome enforces this.
- Keep functions under Biome's cognitive complexity limit of 30 by extracting named steps.
- Record known work as GitHub issues. A `TODO` or `FIXME` must cite one, as in `TODO(#12)`, and `pnpm arch` fails otherwise.
- Add new commands to `src/ui/reader-commands.ts`. That one table feeds the palette, the keyboard and toolbar buttons.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `dhevdotdev/waymark`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
