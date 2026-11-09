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

## Writing notes

In the app, the only code that changes a note is `write_note` in `src-tauri/src/vault.rs`. It accepts Markdown files inside the vault, refuses dot-folders and symlinks that leave the vault, and replaces a file only if it still holds the text the caller expected. Another app writing in the instant between that check and the rename cannot be detected. Note content cannot trigger a write: a task box only acts if this render created it, so one written as HTML in a note does nothing. The development server has a stand-in with the same rule, for browser tests only.

## Frames

A frame in a note can only show a PDF from the vault and is always sandboxed, whatever the note's HTML says. Other vault files are served with a policy that stops them running scripts.
