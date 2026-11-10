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
- The lightbox closes from its backdrop, its close control or Escape, never from a click on what it shows.
- A status refresh or a file list rebuild keeps focus and scroll where they were. If the focused item has gone, focus moves to the sheet that holds it, or to the nearest folder in the list.
- A new tab is a real tab labelled "New tab", blank behind the palette. The first note or graph opened replaces it and leaves nothing to go back to. Escape closes the palette, a second Escape closes the tab, and a blank tab is never restored after a restart.
- ⌘W closes a blank tab even while its palette holds focus, and the tab it opened beside comes back, as with Escape. The last tab stays.
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
- Every table change confirms itself from the difference between the two versions of the table, so undo and redo get the same confirmation as the action. Pointer actions move: a new row or column arrives, a removed one fades where it was, a moved one slides. Keyboard actions and Reduce Motion get the same tint with no movement, held and then gone without a fade, and a keyboard removal simply closes up. An action that cannot happen says why.
- A table at the very start or end of a note has no line beside it. A deliberate move past that edge, by arrow key or click, adds a blank line there, because a caret needs a real place to sit and text must not touch the table, or Markdown reads it as a row.
- Notes move by dragging them in the file list, along the same path as Move to…, so links are rewritten and a note of the same name is never overwritten. The rows hold still during a drag unless the pointer rests on a closed folder, which opens it, or reaches the edge of the list, which scrolls it. A move is refused while Git is changing files, and says so. Escape cancels.
- Notes can be ordered by date modified. The choice is kept with the app's preferences, never in the vault. Date means the file's time on disk, so a fresh clone stamps its notes within about a second, and they fall back to name order until they are edited. Notes a pull changes rise to the top. Folders stay in name order.
- Tabs reorder by dragging and from the tab's menu or the palette. Pinned tabs sit together at the left, survive a relaunch and cannot be closed by accident: closing one says to unpin it first.
- The active tab is the strip's one Tab stop. Left, Right, Home and End move along the strip and select as they go, and focus follows. A click selects a tab without taking focus. A focused close control shows at full strength at once.
- Search reads `path:part` and `-word` alongside words and "quoted phrases". Filters narrow the list and are never highlighted. A query of only filters lists what passes.
- Copy link gives the vault's own `[[Note#Heading]]` form, using the path only when another note shares the name.
- Nothing sits between the path row and the note. The trail is a section in the right panel, so a note starts at the same height whether or not its tab has a trail.
- A destructive confirmation arms nothing when it opens. The dialog holds focus, Return moves to Cancel, and Delete needs its button reached on purpose. Other confirmations keep Return.
- The outline is a dash per heading on the right edge, whether or not the inspector is open. Hovering opens the titles. There is one outline, so the inspector has no tab for it. The dashes step aside while editing.
- A new tab shows the date, three ways to go somewhere, and recently open notes with their task progress.
- Selecting text while editing offers a small formatting bubble. It never appears without a selection.
- Close controls lead their label on tabs, in a 20px target with a 13px icon, the same size as the new-tab plus. A trail stop's remove control sits at the end of its row, at the same size, and shows on hover or focus. Destinations should not read as closable tabs.
- Tabs are as wide as their titles. When they do not all fit, only the widest give up room, so a short title is never clipped to make space for a long one.
- On narrower windows the inspector and sidebar float. A click outside or Escape dismisses them.

## Tables and callouts

A table has a thin rounded outline, in the same shape as code blocks and callouts, so it ends instead of thinning into the paragraph below it. Rows keep their quieter lines and there are no lines between columns, so a sentence in a cell still reads as text. A table's header row has a faint band, and stays in view at the top of the note area while its rows scroll past, in Read and in Edit. A header with nothing in it is a table used for layout, so it gets neither. A table wider than its column scrolls sideways and its header scrolls away with it, because a sideways-scrolling box cannot also pin a row to the page.

Inline code inside a callout takes a stronger tint of that callout's own colour. The plain grey only suits plain paper.

A single newline in a paragraph, callout or list item is a line break, as in Obsidian, unless the vault turns on Strict line breaks.

A selection that runs across table cells in Read fills each whole cell as one block. Text selected inside one cell stays ordinary text highlighting.

## Moving through a note in Edit

A heading's marks hang in the margin and read left to right, so the arrow keys move through them the way they look. Up, Down and Home land on the heading's text, never inside the marks. Up and Down stop on every line, the short gaps between blocks included. Backspace at the start of a heading's text makes it plain text in one step, and one Undo brings the heading back.

## Sync panel

One button leads at a time: Commit & Sync when there is something to commit, otherwise Sync for incoming commits or Push for outgoing ones. A state that can only be resolved in a terminal leads with Open in Terminal, once. Every problem says what happened and offers its next step where there is one. A vault with no remote, a branch with no upstream and a detached HEAD each say which they are, and never claim to be up to date. Quiet text actions such as Stage all use muted ink, not the accent. A commit or diff opens in one sheet of the same size and close button from anywhere, and dates read the same way throughout.

## Coming back to a note

A note is where it was left: after Back and Forward, after another tab, after the graph, after closing a stop on the trail, after Read and Edit, and after a relaunch. A position is never recorded while a different note or the graph is on screen. After a property change adds or removes lines, the reading view is drawn again in place, so its line numbers stay true.

## Properties

The Info pane is the one home for a note's properties. Click a value and it becomes editable where it sits, so the row keeps its shape. Enter saves, Escape puts it back, and leaving the field saves. Lists edit item by item. No key means anything: `status` is treated like any other name.

A change rewrites only that property's lines and every other byte of the file stays as it was, which `src/vault/properties.ts` checks by reading its own result back before it writes. A value keeps its quoting, and its number or boolean kind. New text that a YAML reader would take for a number or a boolean is quoted. Removing the only property removes the empty block as well.

Nested values, block text, anchors, duplicate names and YAML that does not parse are shown as written and never rewritten, with a way into the raw text.

A change goes through the editor when the note is open there, as one undo step under its save and conflict protection, and straight to the file otherwise, with ⌘Z undoing it. A change that fails is reported and the old value comes back.

## Trails

Each tab remembers where following links has taken it. A second link from the same note starts a side branch. A link to a note already on the trail moves there and adds nothing. Opening something from Files, Search or ⌘K starts a new trail, and Back returns to the old one. Trails are saved with the tabs. `src/vault/trail.ts` holds the model.

Nothing about the trail sits above the note. ⌘Y brings the Trail section into view on the current stop, opening the panel or the section if it has to, and pressing it again undoes what that opened.

Links or Info, the trail and the graph are all on screen together, because they get used together. Links or Info take what height is left. The trail and the graph each have a section that folds to its header and remembers it, and a section with nothing to show is not drawn at all, so a tab with no trail has no empty heading. The panel's left edge drags to widen it, and the width is remembered. The top edge of the trail and of the graph drags to make that section taller or shorter, down to a least height and up to what leaves the links readable. A trail too short to resize offers no handle.

The trail is a list, because a tree of long titles does not fit a row. One 28px row per stop, top to bottom. Side branches sit directly under the stop they left from, stepped in 14px, up to three steps, and the main line carries on level after them. The way to the current note is drawn in the accent. The current stop uses the same tint as the current file in the tree. A stop with branches has a chevron in place of its dot, and folding shows how many stops went out of sight. The section is as tall as its stops, sitting on top of the graph, up to a limit where it scrolls on its own. Its height only changes when the trail does, which is when the panel's contents are changing anyway. Only the panel's own controls or Escape close it, so clicking stop after stop keeps it open. In a window too narrow for a docked panel, it slides over the note as the panel always does, and a click on the note dismisses it.

Removing a stop takes out only that stop. Its children move up to its place, nothing else is lost, and the toast offers Undo. Removing the note the tab is on steps the tab back to the stop before it, and Undo returns to it. The panel only sits beside notes, so on a graph, a base or a blank tab Back is the way out.

## Graph

Groups come only from the links, using Louvain community detection, so no folder or filename has any effect. A note keeps its community colour in the rail graph and the full graph. Links inside a community arc gently, and links between communities bend through both centres so they gather into threads. There are no rings or halos. Emphasis is a smooth falloff of light. Hovering sends small pulses along each link in its direction. Community chips light up a cluster and fly to it. Arrow keys walk the notes community by community, starting from the open note, and Return opens one; the focused note is the only bright one, and a note hidden behind the toolbars snaps to the middle.

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

## Where a link goes

Hovering a web or mail link shows its real address under the link, in Read and Edit: the site in full and strong, the rest quieter, three lines at most with the middle of the path cut. The address is read from the link when it is shown, `http://` stays visible, and international hosts stay in their `xn--` form because a decoded name can imitate another site.

## The app stays the app

Nothing replaces Waymark's page. A web address that tries to load inside it opens in the default browser, and anything else is refused. A file or link dropped outside the editor does nothing. Right-clicking a web or mail link, in Read or Edit, offers Open link and Copy link address.

## Window

The window comes back where it was and the size it was, placed before it is shown. The place lives in Application Support, never in the vault. If that screen has gone the window is centred and made to fit. Full screen is restored, and leaving it returns to the size from before.

## Swiping back

A two-finger swipe across the note goes back or forward by the same path as ⌘[ and ⌘]. One swipe is one step, however long its momentum lasts. A swipe that starts over something that scrolls sideways, such as a wide table, stays with that thing. Mouse buttons 4 and 5 do the same where the system delivers them.

## Undoing a delete

Moving a note or folder to the Trash offers Undo. It puts the item back at its exact path, out of the Trash so no duplicate stays there, and brings its tabs back. If something now exists at that path it stays in the Trash and says why.

## ⌘K

With text selected in the note editor, ⌘K makes it a link, the same as the bubble's Link button. Otherwise it opens the palette, as ⌘P and ⌘O always do. A selection inside a table cell keeps the palette, because a cell has no Link button.

## The file list and the keyboard

The file list is one Tab stop. Up and Down move between rows, Right opens a folder and then enters it, Left closes it and then goes to its parent, Enter opens, and Home and End reach the ends. Closed folders are skipped. The focus ring is drawn inside the row, because folder contents are clipped for their open and close animation.

## Menu bar

File, View and Go hold the app's main commands, and Settings… is under Waymark. Every item runs through the command registry, and an item that cannot run now is greyed out. A press that both the page and the menu see runs once. There is no Help menu, because nothing real exists to point it at.

## Reopening tabs

⌘⇧T brings back the last closed tab where it was, with its trail and place in the note, up to the last 20 closed this session. Blank tabs are not kept. A tab whose note has left the vault says so and never opens another note instead.

## Scrolling

Native scrollbars are hidden everywhere and nothing rubber-bands past its edge. One thin bar per direction, drawn by the app, shows while you scroll with the wheel or keys or when the pointer comes within 12px of the edge, and fades after 800ms. It takes no layout space and can be dragged. Scrolling the app does on its own, such as coming back to a note, shows nothing. Resize handles and a trail row's remove button win over the bar.

## Motion and sound

The rules come from Emil Kowalski's animation standards, good-css.com, Impeccable and taste-skill. Where those sources disagree, a short distillation records which rule Waymark follows.

- Nothing triggered from the keyboard animates. The palette, tab switching, back and forward appear instantly, because they happen hundreds of times a day.
- Following a note link with the pointer fades the new page in over 180ms, with no movement. Files, search, the palette, tabs, back and forward show the page at once.
- The palette and the menu bar count as the keyboard, even when a choice in them is clicked. A heading reached by the pointer takes a brief tint that holds until the eye can land on it, and a heading reached any other way does not.
- Popovers and menus grow from the point nearest what opened them, measured after they are pushed back into the window. Sheets and the lightbox stay centred. Entries and exits are transitions, so a reversal starts from where the surface is. A key press shows or removes any of them at once.
- A sheet opened from a sheet changes the open sheet's content, so two never overlap.
- A toast from a key press appears and leaves with no motion. A replaced toast leaves through its exit and takes no clicks while the new one is ready at once. The 400ms entry stays, because the curve has done 92% of its travel by 160ms.
- Every small control presses to the same .97 over 160ms, for the pointer only, because Space and Return also set `:active`. Dense rows and the table only tint.
- Moving the pointer counts as coming back to it, so hover fades return after typing.
- Collapsed callouts and sidebar groups open by animating grid rows when clicked, so the content keeps its height and nothing jumps. Anything revealed for a search, a find or an open note lands at once, so a scroll target is never moving when it is measured.
- Floating panels slide, and the narrow-window scrim fades with the sidebar. Docked panels never animate their width, because that would move the page. Rail sections move only when a fold is clicked, not when the window resizes or a note changes what they hold.
- Things in lists move only for the pointer. Tabs, file rows, bookmarks, trail stops and property rows are at their final place at once and glide from where they were on screen, and a removed tab or row fades as a ghost that takes no space and no clicks. A second change picks each element up from where it had got to. The keyboard, the palette, the menu bar and files changing outside the app are instant, and Reduce Motion keeps only the fade of what is new.
- The graph shows its finished layout and labels on the first frame. Only a new graph opened with the pointer fades in, over 140ms. Community chips and zoom buttons move the camera over 240ms for the pointer, and a move that interrupts another decelerates from where it is drawn. A held note is drawn under the pointer in the same event. A background refresh leaves the camera, spotlight and focus alone.
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
