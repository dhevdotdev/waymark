# Search

## Sub-features

Full-text search in the sidebar, the command palette, find in note.

## How to get to it (user POV)

⌘⇧F searches inside notes. ⌘K finds a note or, after `>`, a command. ⌘F finds in the open note.

## Driving it with Playwright

- Sidebar: press `Meta+Shift+f`, type, read `.search-hit`, press Enter, then check the `search` entry in `CSS.highlights` is on screen.
- Palette: press `Meta+k`, type, read `.palette-row.is-selected .palette-label`, press Enter.
- Find: press `Meta+f`, type, read `.findbar-count`.

## Gotchas

The fixture's unique phrase is `BannetonSeamDriftError`. Escape in Search returns to Files and keeps the query.
