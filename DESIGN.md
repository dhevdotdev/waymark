# Waymark design rationale

Waymark is a client for an Obsidian vault kept in Git, and reading comes first. The document is the product, and the app chrome exists to get you to the next document.

## Principles

1. **The page comes first.** The whole window is one surface in the theme's paper colour. Single hairlines mark the columns, so the note is never a box inside a frame. The app has no cards, badges or dashboard elements.
2. **Use serif for reading and sans for the interface.** Body text uses Source Serif 4 with optical sizing, because these notes are read top to bottom at length. Controls, table headers, callout titles and metadata use Inter. Headings down to `h3` stay in the reading face, so a document reads as one document. Code uses JetBrains Mono with ligatures off, so `->>` and `!=` show exactly what the source contains.
3. **Keep a reading measure.** Prose stays at 42rem, up to about 85 characters. 37rem read as too narrow on a laptop window. Code blocks, tables and callouts all hang 16px outside the text column, so their text keeps the prose's left edge, and they may grow right by 5rem. Diagrams centre on the wider column. Nothing runs edge to edge.
4. **Use one accent.** The default Ember theme's burnt orange marks links, focus, and the current note in the graphs. Callout hues are the only other colours, and they mark the kind of callout.
5. **Impose no organisation.** Waymark has opinions about how notes look, and none about how they are arranged. It shows the folders on disk and renders Markdown as written. No filename, folder name, heading or frontmatter key has special meaning, except `aliases`, which is how Obsidian links resolve. Frontmatter appears in the Info pane exactly as written.
6. **Give every kind of thing one home.** Files live in the left tree. The note's location and reading time sit above it, in the pane head. The outline sits on the right edge of the reading pane. Links and properties live in the inspector, with the local graph pinned below them. Vault state, Git and whole-vault views live in the status bar. The note body holds only the note, and the sidebar column sets where tabs begin.
7. **Fail visibly and safely.** Waymark never resolves a missing link or an ambiguous name by guessing. A missing link is dashed and muted. A name shared by several files is flagged, and Waymark lists the candidates. A diagram that does not parse shows its error above the readable source. A remote image becomes a labelled placeholder and is not fetched.
8. **Nothing moves because work finished.** Loading never pushes content. Space is held for what is coming, and quick work shows no loader at all. A loader appears only after 350 ms, in a spot reserved for it.

## Navigation

Every state has a visible way in and a visible way out.

- The sidebar always shows a `Files | Search` switch. Search keeps its query and results while you are in Files. Escape returns to Files, and the X only clears the field.
- The graph is a tab, as in Obsidian. ⌘G brings an open graph forward or opens one beside the current tab. Clicking a note in it replaces it in that tab, and Back returns to it. Escape steps back or closes the tab.
- Anything that covers something closes with Escape and has a visible control. The button that opened a view stays pressed while the view is open.
- A new tab is a real tab labelled "New tab", blank behind the palette. The first note or graph opened replaces it and leaves nothing to go back to. Escape closes the palette, a second Escape closes the tab, and a blank tab is never restored after a restart.
- The palette is anchored at its top edge and sizes to its results up to a maximum, so the field and the rows above never move. Headings appear only before a query.
- The Dock icon follows the theme family while Waymark runs, recoloured from one artwork by `scripts/theme-icons.mjs`. macOS shows the bundled Catppuccin icon whenever the app is closed.
- Note history can bring back an older version. It is written to the working file as an ordinary uncommitted change, so it goes through the normal review and commit. Anything that Git does not hold is first saved as a copy beside the note, after asking. Git's history is never rewritten.
- On a conflict, Compare shows both sides read-only, with Keep both, Keep mine and Use other version. The side not chosen goes to the macOS Trash, so neither choice loses text, and if it cannot be set aside nothing changes.
- A note reopens where reading stopped, even after a relaunch. The place is a line number kept in the app's preferences, never in the note. A link to a heading or a search match still goes to that target.
- Back up every 10 minutes is off by default. A routine run is silent. A problem appears in the sync indicator and panel and is announced once until it changes, and an offline run commits here and pushes later without announcing anything.
- Bookmarks are notes and headings saved per vault in the app's preferences, shown above the folders once there is one and listed in the palette. A bookmark follows a rename or move. One whose note has gone stays in the list marked as missing and never opens anything else.
- Pasting from the web becomes Markdown in one undo step. Copies from code editors and pastes inside code stay plain, and ⌘⇧V always pastes plain text. A remote image becomes a plain link, so a note never fetches it.
- A `.base` file opens as a read-only table. Anything it cannot evaluate is stated plainly with no list under it, because a partial list that looks complete would be worse than none.
- Obsidian's "Excluded files" are hidden from the tree, palette, search and graph. The sync panel still lists them when they change, since hiding a changed file from review would be unsafe.
- Sync opens as a centred sheet at one fixed size, like a diff. It is a separate task, so it does not slide out of the panel that describes the current note.
- Notes are created with ⌘N or the row above Files, named in the title, and managed from buttons that appear on the row under the pointer or a right-click. Names are edited in the tree, not in a dialog. A new folder starts with a first note in it, because the tree lists notes and Git keeps no empty folders. A note goes to the Trash without asking unless other notes link to it. New notes and attachments go where the vault's Obsidian settings say. Renaming or moving updates links in other notes, including Markdown links relative to the note they are in. Folders can be renamed and deleted the same way, and deleting goes to the macOS Trash. Commit & Sync takes the changed notes and their files. Hidden files such as Obsidian's settings are committed only if staged by hand.
- In the editor, code has the same colours as in Read, and diagrams and math are drawn until the cursor enters them. The file's text never changes for any of this.
- In the editor, `/` inserts blocks and `[[` completes links and headings. Pasting or dropping an image saves it into the vault and embeds it.
- The toolbar holds the search button, so Files and Search need no row of their own, and the inspector's tabs share the top row with its toggle.
- Task boxes sit where the bullet would be and toggle the task in the file. ⌘Z undoes the last one. Done items are dimmed, not struck through, so they stay easy to read.
- Read and Edit are a switch at the right of the pane head, because two modes need to be visible. ⌘E flips between them, and reading stays the default.
- Editing keeps the reading column and type. Syntax appears only on the line being edited, a tick means the disk has it, and the status bar shows line, column and word count. Frontmatter stays out of sight until the cursor moves into it, so switching to Edit never pushes the note down, and the inspector still shows it exactly as written.
- A table in the editor is a real table. Each cell is typed into directly and written back to just that cell's text in the file, and Tab, Enter and the arrows move between cells. Edit as text is there for the odd table that needs it.
- A table has two keyboard states, as the ARIA grid pattern describes. A cell you click or Tab into is being edited. Escape selects the cell, and then the arrows, Home, End and Page keys move cell to cell, Enter or F2 edits, Tab reaches the handles and add bars, and a second Escape leaves. One list of actions in `src/ui/table-actions.ts` drives the menus and the shortcuts, so they cannot disagree.
- Table controls sit outside the table, measured from its real box, with 6px of clear space and a 24px target. A table only hangs into the margins where its controls still fit, and is flush with the text otherwise, so the gap around every table, 38px above and 40px below in Read as well as Edit, is the reserved room and nothing moves on hover. At rest an add control is a bare plus. Hovering it fills that control alone and names it. Hovering a handle tints exactly the row or column it will change, and that tint stays while its menu is open. A small handle at the table's top-left corner holds Edit as Markdown and Delete table, and the palette offers Delete table while the cursor is in one. Menus open beside their target, never on it. There is no size picker: a new table is three columns and two rows, and growing it is one click.
- Every table change confirms itself from the difference between the two versions of the table, so undo and redo get the same confirmation as the action. Pointer actions move: a new row or column arrives, a removed one fades where it was, a moved one slides. Keyboard actions and Reduce Motion get the same tint with no movement. An action that cannot happen says why.
- A table at the very start or end of a note has no line beside it. A deliberate move past that edge, by arrow key or click, adds a blank line there, because a caret needs a real place to sit and text must not touch the table, or Markdown reads it as a row.
- Notes move by dragging them in the file list, along the same path as Move to…, so links are rewritten and a note of the same name is never overwritten. The rows hold still during a drag unless the pointer rests on a closed folder, which opens it, or reaches the edge of the list, which scrolls it. A move is refused while Git is changing files, and says so. Escape cancels.
- Notes can be ordered by date modified. The choice is kept with the app's preferences, never in the vault. Date means the file's time on disk, so a fresh clone stamps its notes within about a second, and they fall back to name order until they are edited. Notes a pull changes rise to the top. Folders stay in name order.
- Tabs reorder by dragging and from the tab's menu or the palette. Pinned tabs sit together at the left, survive a relaunch and cannot be closed by accident: closing one says to unpin it first.
- Search reads `path:part` and `-word` alongside words and "quoted phrases". Filters narrow the list and are never highlighted. A query of only filters lists what passes.
- Copy link gives the vault's own `[[Note#Heading]]` form, using the path only when another note shares the name.
- The trail is one row above the note, and the note's area starts below it, so nothing slides under it. Branches open over the page from its chevron and close with Escape.
- A destructive confirmation arms nothing when it opens. The dialog holds focus, Return moves to Cancel, and Delete needs its button reached on purpose. Other confirmations keep Return.
- The outline is a dash per heading on the right edge, whether or not the inspector is open. Hovering opens the titles. There is one outline, so the inspector has no tab for it. The dashes step aside while editing.
- A new tab shows the date, three ways to go somewhere, and recently open notes with their task progress.
- Selecting text while editing offers a small formatting bubble. It never appears without a selection.
- Close controls lead their label on tabs and trail stops, in a 20px target with a 13px icon, the same size as the new-tab plus. Every trail stop has a quiet pill, so its always-visible remove control belongs to something.
- Tabs are as wide as their titles. When they do not all fit, only the widest give up room, so a short title is never clipped to make space for a long one.
- On narrower windows the inspector and sidebar float. A click outside or Escape dismisses them.

## Trails

Each tab keeps a map of where following links has taken it, drawn over the top of the note once it has more than one note, in space the title already leaves free, so following a link moves nothing. Following a link grows a branch from the current note, and a second link from the same note opens a new row. Clicking any note on the map moves that tab there and leaves the map intact. A link to a note already on the map moves there too, and draws nothing, because a line back would break the tree the map is drawn as. Opening something from Files, Search or ⌘K starts a new trail, and Back returns to the old one. Trails are saved with the tabs. `src/vault/trail.ts` holds the model.

## Graph

Groups come only from the links, using Louvain community detection, so no folder or filename has any effect. A note keeps its community colour in the rail graph and the full graph. Links inside a community arc gently, and links between communities bend through both centres so they gather into threads. There are no rings or halos. Emphasis is a smooth falloff of light. Hovering sends small pulses along each link in its direction. Community chips light up a cluster and fly to it.

## Vertical rhythm

The note body is a CSS grid, and grid items never collapse margins. Every gap is therefore set from the pair of blocks it separates, in one block of rules at the end of `src/styles/document.css`. Text to text is 16px. Code, callouts, diagrams and images get 24px, and tables 38px above and 40px below, which is the room their editing controls need. A heading has the same space above it whatever came before: `h2` 40px, `h3` 28px, `h4` 24px. `scripts/gaps.mjs` measures every pair across a vault.

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
| Motion | One curve family with no overshoot. Ease-out `cubic-bezier(.23,1,.32,1)` for enter and exit, ease-in-out for travel. Hover 150ms, press 160ms at scale .97, menus 200ms, sidebar 240ms, sheets 250ms, toasts 400ms. Exits are faster than entries. Reduce Motion zeroes travel distances and keeps fades. |
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
- While writing, each key sounds like a recorded mechanical switch, with a press and its own release, placed left to right by where the key sits. Quick typing lands softer than a deliberate press, and a held key repeats silently. Linear, Tactile or Clicky are chosen in settings, and picking one plays a few keys so it can be judged at once.
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
