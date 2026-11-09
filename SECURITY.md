# Security

Waymark treats note content as untrusted, because a vault can be cloned from anywhere.

| Boundary | Guarantee | Enforced in |
|---|---|---|
| Note HTML | No scripts, handlers, forms or remote loads | `src/render/sanitize.ts`, CSP in `src-tauri/tauri.conf.json` |
| File access | Inside the vault, never dot-folders, checked again after symlinks resolve | `src-tauri/src/vault.rs` |
| Git arguments | Revisions are hex only, paths follow `--`, remotes are never taken from notes | `src-tauri/src/git/mod.rs` |
| Credentials | Passed over stdin to the user's helper, redacted from errors | `src-tauri/src/git/runner.rs` |
| Preferences | Stored outside the vault, validated per key | `src/prefs.ts` |

Report a problem privately to the repository owner through a GitHub security advisory.

The app may fetch only its own bundled files and its native bridge. It needs the bundled files to decode its key sounds, and no note can start a fetch because notes cannot run scripts.

## Writing notes

In the app, the only code that changes a note's text is `write_note` in `src-tauri/src/vault.rs`. It accepts Markdown files inside the vault, refuses dot-folders and symlinks that leave the vault, and replaces a file only if it still holds the text the caller expected. Another app writing in the instant between that check and the rename cannot be detected. Note content cannot trigger a write: a task box only acts if this render created it, so one written as HTML in a note does nothing. The development server has a stand-in with the same rule, for browser tests only.

Renaming and trashing a folder go through `real_folder` in `src-tauri/src/folders.rs`, which accepts only a real, visible folder inside the vault: never the vault itself, a dot-folder or a symlink. A rename refuses to land on anything that exists, and a delete goes to the macOS Trash.

## Frames

A frame in a note can only show a PDF from the vault and is always sandboxed, whatever the note's HTML says. Other vault files are served with a policy that stops them running scripts.
