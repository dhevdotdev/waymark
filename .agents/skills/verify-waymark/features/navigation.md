# Navigation

## Sub-features

Follow a link, back and forward, tabs, background tabs, trail map, file tree.

## How to get to it (user POV)

Click a link inside a note. ⌘[ and ⌘] retrace. ⌘-click opens a background tab. The trail appears in the panel's Trail section once a tab has two stops.

## Driving it with Playwright

- Follow: click `.doc a.wikilink[data-path$="<file>.md"]`, then read `.doc-title`.
- Trail: count `.trail-node`, click `.trail-name`, remove with `.trail-x`, fold with `.trail-fold`.
- Tabs: `.tab`, `.tab-close`, `[data-act="new-tab"]`.
- Tree: `.tree-head[data-folder="..."]`, `.nav-item[data-path$="..."]`.

## Gotchas

Following a link grows the trail. Jumping from the tree, Search or the palette grows it too, hung from the note the tab was on with a dotted line (`.trail-lines path.is-jump`).
