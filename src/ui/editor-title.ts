import type { EditorState, Extension } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { levelOneHeading } from "../vault/own-title";
import { frontmatterEnd } from "./live-preview";

const TITLE_LINE = Decoration.line({ class: "cm-own-title" });

function titleLine(state: EditorState): DecorationSet {
  const { doc } = state;
  for (let n = doc.lineAt(frontmatterEnd(state)).number; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) continue;
    return levelOneHeading(line.text) === null ? Decoration.none : Decoration.set([TITLE_LINE.range(line.from)]);
  }
  return Decoration.none;
}

/**
 * A note that opened with its own name as a heading keeps that heading set as its title while it is edited, so the
 * page does not move between Read and Edit. Retyping the heading keeps the look until the next time it is opened.
 */
export function ownTitle(enabled: boolean): Extension {
  if (!enabled) return [];
  return StateField.define<DecorationSet>({
    create: titleLine,
    update: (lines, tr) => (tr.docChanged ? titleLine(tr.state) : lines),
    provide: (field) => EditorView.decorations.from(field),
  });
}
