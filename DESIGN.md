# Waymark design rationale

Waymark is a reader for an Obsidian vault kept in Git. The document is the product, and the app chrome exists to get you to the next document.

## Principles

1. **The page comes first.** The whole window is one surface in the theme's paper colour. Single hairlines mark the columns, so the note is never a box inside a frame. The app has no cards, badges or dashboard elements.
2. **Use serif for reading and sans for the interface.** Body text uses Source Serif 4 with optical sizing, because these notes are read top to bottom at length. Controls, table headers, callout titles, `h3` and metadata use Inter. Code uses JetBrains Mono with ligatures off, so `->>` and `!=` show exactly what the source contains.
3. **Keep a reading measure.** Prose stays at 37rem, about 66 to 72 characters. Code blocks and tables keep the prose's left edge and may grow right by 5rem. Diagrams centre on the wider column. Nothing runs edge to edge.
4. **Use one accent.** Catppuccin mauve marks links, focus, and the current note in the graphs. Callout hues are the only other colours, and they mark the kind of callout.
5. **Impose no organisation.** Waymark has opinions about how notes look, and none about how they are arranged. It shows the folders on disk and renders Markdown as written. No filename, folder name, heading or frontmatter key has special meaning, except `aliases`, which is how Obsidian links resolve. Frontmatter appears in the Info pane exactly as written.
6. **Give every kind of thing one home.** Files live in the left tree. The note's location and reading time sit above it, in the pane head. Outline, links and properties live in the inspector on the right, with the local graph pinned below them. Vault state, Git and whole-vault views live in the status bar. The note body holds only the note, and the sidebar column sets where tabs begin.
7. **Fail visibly and safely.** Waymark never resolves a missing link or an ambiguous name by guessing. A missing link is dashed and muted. A name shared by several files is flagged, and Waymark lists the candidates. A diagram that does not parse shows its error above the readable source. A remote image becomes a labelled placeholder and is not fetched.

## Navigation

Every state has a visible way in and a visible way out.

- The sidebar always shows a `Files | Search` switch. Search keeps its query and results while you are in Files. Escape returns to Files, and the X only clears the field.
- The graph is a tab, as in Obsidian. ⌘G brings an open graph forward or opens one beside the current tab. Clicking a note in it replaces it in that tab, and Back returns to it. Escape steps back or closes the tab.
- Anything that covers something closes with Escape and has a visible control. The button that opened a view stays pressed while the view is open.
- A new tab is a real tab labelled "New tab", blank behind the palette. The first note or graph opened replaces it and leaves nothing to go back to. Escape closes the palette, a second Escape closes the tab, and a blank tab is never restored after a restart.
- Close controls lead their label on tabs and trail stops, in a 20px target with a 13px icon, the same size as the new-tab plus.
- Tabs are as wide as their titles. When they do not all fit, only the widest give up room, so a short title is never clipped to make space for a long one.
- On narrower windows the inspector and sidebar float. A click outside or Escape dismisses them.

## Trails

Each tab keeps a map of where following links has taken it, drawn under the tabs once it has more than one note. Following a link grows a branch from the current note, and a second link from the same note opens a new row. Clicking any note on the map moves that tab there and leaves the map intact. Opening something from Files, Search or ⌘K starts a new trail, and Back returns to the old one. Trails are saved with the tabs. `src/vault/trail.ts` holds the model.

## Graph

Groups come only from the links, using Louvain community detection, so no folder or filename has any effect. A note keeps its community colour in the rail graph and the full graph. Links inside a community arc gently, and links between communities bend through both centres so they gather into threads. There are no rings or halos. Emphasis is a smooth falloff of light. Hovering sends small pulses along each link in its direction. Community chips light up a cluster and fly to it.

## Vertical rhythm

The note body is a CSS grid, and grid items never collapse margins. Every gap is therefore set from the pair of blocks it separates, in one block of rules at the end of `src/styles/document.css`. Text to text is 16px. Code, tables, callouts, diagrams and images get 24px. A heading has the same space above it whatever came before: `h2` 40px, `h3` 28px, `h4` 24px. `scripts/gaps.mjs` measures every pair across a vault.

## Tokens

`src/styles/tokens.css` holds the full set. Summary:

| Group | Values |
|---|---|
| Faces | Source Serif 4 (reading), Inter (UI), JetBrains Mono (code). All are bundled, so Waymark fetches no fonts. |
| Reading sizes | Body 17px/1.65 · small (callouts, tables) 15px · code 13px/1.6 · h2 22px · title 34px |
| UI sizes | 13px controls, 11px metadata |
| Geometry | Measure 37rem, wide extra 5rem, gutter 2.5rem (1.25rem below 640px) |
| Space | 4px base: 4, 8, 12, 16, 24, 32, 48, 72 |
| Radii by role | Control 6, block 10, floating surface 12 |
| Motion | One curve family with no overshoot. Ease-out `cubic-bezier(.23,1,.32,1)` for enter and exit, ease-in-out for travel. Hover 150ms, press 160ms at scale .97, menus 200ms, sidebar 240ms, sheets 250ms, toasts 400ms, sync drawer 420ms. Exits are faster than entries. Reduce Motion zeroes travel distances and keeps fades. |
| Themes | Four families, each with a light and a dark variant: Catppuccin (Latte/Mocha), Rosé Pine (Dawn/Moon), Gruvbox and Everforest. Each supplies a palette, a sheet colour and an accent, and code highlighting follows the same family. Light sheets are lifted toward white for long reading. |

## Critique log for the reading checkpoint

Each round was judged from WebKit screenshots of real notes, not from mockups.

| Round | Problem | Change |
|---|---|---|
| 1 | Inline code in tables broke mid-word (`EAGE` / `R`) | Inline code wraps only at word boundaries, and table code does not wrap |
| 1 | Tables and code jutted out past the prose's left edge | Both keep the text edge, hanging only by their own padding, and grow right |
| 1 | The Terms glossary was heavy: wide term column, loud rules | Narrower term column, tighter rows, lighter rules |
| 1 | Shiki's italic tokens were synthesised obliques | Code tokens stay upright |
| 1 | The Latte sheet looked grey against the chrome | Lifted the sheet toward white |
| 2 | Mermaid rejected `oklab()` theme colours, so no diagram rendered | Resolve tokens to hex through a canvas before passing them to Mermaid |
| 2 | Diagrams rendered at 300px because their container shrink-wrapped | The SVG fills the figure and is capped at its natural width |
| 2 | Mermaid clipped labels it measured before Inter loaded | Wait for the UI face before layout |
| 3 | At 760px the reader collapsed to zero width | Below 960px the sidebar floats over the sheet instead of taking a column |
| 3 | Scrolling to a block shifted the whole window chrome | The shell clips instead of hiding overflow, so programmatic scrolls stay in the reader |
| 3 | The sanitizer removed the copy and fold buttons | Buttons are allowed. Only renderer-emitted `data-*` attributes survive, so note HTML cannot trigger app actions |

## Motion and sound

The rules come from Emil Kowalski's animation standards, good-css.com, Impeccable and taste-skill. Where those sources disagree, a short distillation records which rule Waymark follows.

- Nothing triggered from the keyboard animates. The palette, tab switching, back and forward appear instantly, because they happen hundreds of times a day.
- Following a link with the pointer fades the new page in over 180ms, with no movement.
- Popovers scale from their trigger, while sheets and the lightbox stay centred. Toasts rise and stay interruptible because they are transitions, not keyframes.
- Collapsed callouts and sidebar groups open by animating grid rows, so the content keeps its height and nothing jumps.
- Sound is a small synthesised palette: copy, a new background tab, sync finished, incoming changes, commit, push, and a problem. Each cue has a 900ms cooldown, so repeated actions never pile up. Nothing plays for clicks, scrolling, typing or background fetches. One toggle mutes everything.

## Polish review

| Problem | Change |
|---|---|
| Language labels covered the ends of long code lines | The label appears only on hover, beside Copy |
| Graph labels piled on top of each other | Labels are placed greedily by importance, and any label that would collide is skipped |
| A few orphan notes shrank the whole graph | The view fits the central 96% of nodes |
| Search ranked scattered words above the exact phrase | A note containing the words as typed scores three times higher, and its snippet shows that phrase |
| In the packaged app, `freezePrototype` broke Mermaid | Turned off. CSP and DOMPurify still constrain note content |
| In the packaged app, the dev `<meta>` CSP blocked `vault://` images | That CSP now allows `vault:` for images and frames only |
