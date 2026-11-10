# Waymark

A Mac client for an Obsidian vault kept in Git. Notes stay ordinary Markdown files. Waymark reads them, edits them as plain text with a live preview, and syncs through your own `git`.

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
| ⌘K with text selected in Edit | Turn the selection into a link |
| ⌘T | New tab |
| ⌘⇧E / ⌘⇧F | Files / Search in the sidebar |
| ⌘⇧F | Search inside notes; ↵ opens at the match |
| ⌘F | Find in this note |
| ⌘[ / ⌘] | Back / forward |
| ⌘-click, middle-click | Open a link in a background tab (⌘⇧-click: foreground) |
| ⌘⇧[ / ⌘⇧], ⌃Tab, ⌘1…9 | Switch tabs |
| ⌘W | Close tab |
| ⌘⇧T | Reopen the last closed tab |
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
- Staging, committing and pushing are explicit buttons in the sync panel. The one exception is Back up every 10 minutes, off by default: once turned on, it commits every change Git would track as `vault backup: <date and time>`, fast-forwards when that is safe, and pushes. It never force-pushes, resets, stashes or merges, and stops and explains itself on a diverged branch, an unfinished merge, a note awaiting a choice, or a sign-in failure.
- History: vault log, per-note log (follows renames), diffs per commit, comparing a past version with the current one, and reading a past version.
- Waymark does not touch `.obsidian/`, ignore files or Git config. Preferences live in `~/Library/Application Support/dev.dhev.folio/`.

## Develop

```sh
pnpm bootstrap
WAYMARK_VAULT=/path/to/vault pnpm dev        # browser preview at http://localhost:5178 (no Git)
pnpm tauri dev                             # desktop app with hot reload
pnpm tauri build --bundles app             # release .app
```

## Checks

```sh
pnpm check                  # lint, types, architecture, dead code, duplication, unit tests with coverage, Rust
pnpm test:e2e               # the reader driven like a person, in WebKit, in normal and Reduce Motion
pnpm test:sweep             # every fixture note: render time, diagrams, links, images, network
pnpm test:visual <ref>      # every surface compared pixel by pixel with another commit
pnpm test:native            # builds the app and runs its self-test against disposable vaults
```

All of these use a generated fixture vault, so no real notes are needed.

## Contributing

`AGENTS.md` lists the commands and rules. `ARCHITECTURE.md` maps the code. `DESIGN.md` holds the design rationale.

## Credits

The typing sounds are recordings from the [Keyboard Sound Dataset](https://zenodo.org/records/16564409) (MIT, Sony) and [typing.wav by Dustin_Davis](https://freesound.org/people/Dustin_Davis/sounds/399603/) (CC0), as edited by [Switchtone](https://github.com/gabrimatic/switchtone) (MIT). The notices are in `public/licenses/key-sounds.txt`.
