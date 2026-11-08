# Sync only ever fast-forwards

Waymark applies incoming commits only as a fast-forward, and explains every other state instead of resolving it. Notes are irreplaceable, and a reader has no merge editor, so any automatic merge, rebase, stash or reset risks losing work without the user seeing it. Divergence is handed to the user's terminal.
