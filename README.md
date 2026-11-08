# Waymark

A Mac reader for an Obsidian vault kept in Git. Notes stay ordinary Markdown files. Waymark reads them, never edits them, and syncs through your own `git`.

## Install the build

```sh
cp -R src-tauri/target/release/bundle/macos/Waymark.app /Applications/
open /Applications/Waymark.app
```

The build is not signed or notarised. It runs on the Mac that built it. On another Mac, right-click the app and choose Open the first time.

On first launch, choose **Open a vault…** (an existing folder) or **Clone from a remote…** (any Git URL, SSH or HTTPS). Waymark uses the same credentials as `git` in Terminal: your SSH agent, or the macOS Keychain through git's `osxkeychain` helper. If an HTTPS remote refuses access, the sync panel offers to store a token in the Keychain.

## Keys

| Keys | Action |
|---|---|
| ⌘K, ⌘O, ⌘P | Go to a note, or type `>` for commands |
| ⌘T | New tab |
| ⌘⇧E / ⌘⇧F | Files / Search in the sidebar |
| ⌘⇧F | Search inside notes; ↵ opens at the match |
| ⌘F | Find in this note |
| ⌘[ / ⌘] | Back / forward |
| ⌘-click, middle-click | Open a link in a background tab (⌘⇧-click: foreground) |
| ⌘⇧[ / ⌘⇧], ⌃Tab, ⌘1…9 | Switch tabs |
| ⌘W | Close tab |
| ⌘G / ⌘⇧G | Graph of the vault / around this note |
| ⌘\ / ⌥⌘\ | Toggle sidebar / inspector |
| ⌘⇧S | Sync: fetch, then fast-forward if safe |
| ⌘⇧Y / ⌘⇧H | Changes and sync panel / history of this note |
| ⌘, | Theme, appearance, sounds, sync checks |
| ⌘+ / ⌘− / ⌘0 | Text size |
| ⌘⇧L | Toggle light and dark |

## Git behaviour

- Reading never waits for the network. Fetching is manual by default. Checking on launch, and every 15 minutes, are opt-in, and both only fetch.
- **Sync** fetches, then applies incoming commits only when that is a fast-forward. Diverged histories, local edits that incoming commits would overwrite, and unfinished merges or rebases are explained, and Waymark offers Terminal as the route to resolve them. Waymark never merges, rebases, stashes, resets or force-pushes.
- Staging, committing and pushing are explicit buttons in the sync panel. Nothing is committed or pushed automatically.
- History is read-only: vault log, per-note log (follows renames), diffs per commit, comparing a past version with the current one, and reading a past version.
- Waymark does not touch `.obsidian/`, ignore files or Git config. Preferences live in `~/Library/Application Support/dev.dhev.folio/`.

## Develop

```sh
pnpm install
FOLIO_VAULT=/path/to/vault pnpm dev        # browser preview at http://localhost:5178 (no Git)
pnpm tauri dev                             # desktop app with hot reload
pnpm tauri build --bundles app             # release .app
```

## Checks

```sh
pnpm test                                  # TypeScript: links, comments, frontmatter, renderer, sanitizer
(cd src-tauri && cargo test)               # Rust: path guard, Git safety on throwaway repositories, redaction
node scripts/sweep.mjs                     # every note in WebKit: render time, diagrams, links, images, network
node scripts/interact.mjs <dir> [reduced]  # 31 behaviours driven like a person would; records video
node scripts/ui-shots.mjs <dir> [light|dark]
scripts/capture-native.sh <vault> "show:<note>:<graph|palette|sync|search|>" out.png [light|dark]
```

The packaged app also has a self-test. Run the binary inside `Waymark.app` with `FOLIO_SELFTEST_OUT=report.json FOLIO_SELFTEST_VAULT=<vault>` and `FOLIO_SELFTEST_MODE` set to one of these modes:

- `read`: renders every note and checks `vault://` images, diagrams, search, Git status, history and diffs over IPC, and that no network request is made.
- `git`, `diverged`, `blocked`: run against a disposable fixture repository.

The self-test does nothing unless those variables are set, and it writes no preferences.

## Layout

- `src-tauri/src/vault.rs`: vault path guard, file listing, `vault://` assets
- `src-tauri/src/git.rs`: Git via the system binary, with error classification and redaction
- `src-tauri/src/lib.rs`: commands, file watcher, preferences, menu
- `src/render/`: Markdown pipeline (wikilinks, callouts, embeds, math, Shiki, Mermaid, sanitising)
- `src/vault/`: link resolution, folder tree, link graph, link communities
- `src/search.ts`: full-text index
- `src/ui/`: app shell, palette, find, sync panel, diffs, graph, sound, welcome
- `src/styles/`: tokens, document surface, chrome, components
- `DESIGN.md`: rationale, tokens and the critique log
