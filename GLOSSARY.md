# Glossary

**Vault**: a folder of Markdown files, usually a Git repository, that Waymark reads.

**Note**: a Markdown file in a vault.

**Attachment**: any other file in a vault. A link names an attachment only when no note answers to that name.

**Wikilink**: a link written `[[Target]]`. It may carry an alias after `|` and a heading after `#`.

**Embed**: a wikilink starting with `!`, which shows the target inside the note.

**Backlink**: a link to the open note from another note.

**Tab**: one place in the window where a view is shown. Each tab has its own trail.

**View**: what a tab shows: a note, a graph, or blank until something is chosen.

**Trail**: the map of where one tab has been. It is a branching graph, not a list. Following a link grows it. Jumping from the tree, Search or the palette grows it too, drawn with a dotted line because no link led there.

**Stop**: one place on a trail.

**Inspector**: the right panel, holding Links and Info. Also called the rail in code.

**Outline**: the dashes on the right edge of the reading pane, one per heading.

**Community**: a group of notes that link to each other more than to the rest. Waymark derives it from links alone.

**Graph**: the view of notes as points joined by their links. It covers the whole vault or one note's neighbourhood.

**Sync**: a fetch followed by a fast-forward when that is safe.

**Diverged**: the local branch and its remote each have commits the other lacks. Waymark explains this and does not resolve it.

**Blocked**: incoming commits would overwrite uncommitted local edits.

**Draft**: the text being edited and the version known to be on disk.

**Live preview**: editing the file's plain text while it looks rendered, with syntax shown only on the line being edited.

**Conflict**: a note changed on disk while it had unsaved edits. Autosave stops until the user chooses.

**Commit & Sync**: one press that brings in the remote, commits and pushes, in that order.

**Fixture vault**: the generated, synthetic vault that tests run against.

**Self-test**: checks that run inside the packaged app against a disposable vault.
