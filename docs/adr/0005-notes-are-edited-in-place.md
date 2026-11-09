# 5. Notes are edited in place, as plain text

Waymark started as a reader that never wrote to a note. It is now the only client its author opens, with Obsidian kept as the format that guarantees portability, so it has to edit.

A rich-text editor would parse Markdown into a document and print it back, which reformats lines nobody touched and fills Git history with noise. The editor is CodeMirror working on the file's own text, with decorations that make it look rendered. Hiding `**` does not remove it. A file that is opened and left alone is never written, and a change touches only the characters typed.

Every write goes through `vault::write_note`, which replaces a note only if it still holds the text the caller last saw. With no expected text the note must not exist yet. There is no way to ask for a blind overwrite. If the file changed, autosave stops and the user chooses Keep mine or Keep both, and keeping mine still states the version being replaced.

Commits and pushes stay explicit. Commit & Sync brings in the remote before committing, because a commit made on a stale branch is what creates a diverged history, and it stops with nothing committed if incoming work touches the same notes.
