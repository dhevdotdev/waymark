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

The only code that changes a note is `write_note` in `src-tauri/src/vault.rs`. It accepts Markdown files inside the vault, refuses dot-folders and symlinks that leave the vault, and replaces a file only if it still holds the text the caller expected. Nothing in a note can trigger a write without the reader clicking or typing.
