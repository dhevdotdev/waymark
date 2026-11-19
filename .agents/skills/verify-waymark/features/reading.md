# Reading

## Sub-features

Markdown, wikilinks, callouts, Mermaid, math, code copy, embeds, heading links, list markers, backlinks, unlinked mentions.

## How to get to it (user POV)

Open a note from the tree, a link or the palette. Scroll.

## Driving it with Playwright

- Heading link: click `.doc a.wikilink[data-anchor="Fixes"]`, then check `[data-key="fixes"]` sits near the top of `.scroller`.
- Code copy: hover `.doc .code`, click `.code-copy`, and expect a `.is-done` class.
- Folded callout: open a note with `> [!note]-`, then click `.callout[data-fold] .callout-title` and compare `.callout-body` height.
- Unlinked mentions: click `.mentions-toggle` in the Links pane, then `.mention-link` on a `.mention`, and read the source file back.
- Diagram: wait for `.diagram-svg svg`, hover `.diagram`, click `.diagram-expand`, expect `.lightbox svg`.

## Gotchas

Diagrams render after the text, so wait for the SVG. A `.png` in a note only loads through `vault://` in the packaged app or `/@vault/file` in the preview.
