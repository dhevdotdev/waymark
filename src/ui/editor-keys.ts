import { cursorLineDown, cursorLineUp } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { BlockType, type EditorView, type KeyBinding } from "@codemirror/view";

/** Where a heading's own text starts on the line holding `pos`, or -1 when that line is not a heading. */
function headingTextStart(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  const marker = /^#{1,6}[ \t]+/.exec(line.text);
  if (!marker) return -1;
  const mark = syntaxTree(state).resolveInner(line.from, 1);
  const block = mark.name === "HeaderMark" ? mark.parent : mark;
  return block?.name.startsWith("ATXHeading") ? line.from + marker[0].length : -1;
}

const oneCaret = (state: EditorState) => state.selection.ranges.length === 1 && state.selection.main.empty;

/**
 * Backspace at the start of a heading's text makes it plain text in one step.
 * Deleting only the space would leave "##Title" behind as body text.
 */
function unheading(view: EditorView): boolean {
  const { state } = view;
  const { head } = state.selection.main;
  if (!oneCaret(state) || headingTextStart(state, head) !== head) return false;
  view.dispatch({
    changes: { from: state.doc.lineAt(head).from, to: head },
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
}

/**
 * Moves one line, and never past one. How far a move travels depends on the
 * font and the height of the line, so a short gap or a heading with space above
 * it can otherwise be stepped over. Lands on a heading's text, not in its marks.
 */
function stepLine(view: EditorView, forward: boolean): boolean {
  if (!oneCaret(view.state)) return false;
  const start = view.state.selection.main.head;
  const from = view.state.doc.lineAt(start).number;
  const left = view.coordsAtPos(start)?.left;
  if (!(forward ? cursorLineDown : cursorLineUp)(view)) return false;
  const { state } = view;
  const { head } = state.selection.main;
  const landed = state.doc.lineAt(head).number;
  const next = from + (forward ? 1 : -1);
  let target = head;
  if (landed !== from && landed !== next && next >= 1 && next <= state.doc.lines) {
    const skipped = state.doc.line(next);
    const block = view.lineBlockAt(skipped.from);
    if (block.type === BlockType.Text && block.from === skipped.from && block.height > 0) {
      const lineHeight = view.defaultLineHeight;
      const y =
        view.documentTop + (forward ? block.top + Math.min(block.height / 2, lineHeight * 2) : block.bottom - lineHeight / 2);
      const at = left === undefined ? null : view.posAtCoords({ x: left, y }, false);
      target = at === null ? skipped.from : Math.max(skipped.from, Math.min(skipped.to, at));
    }
  }
  if (state.doc.lineAt(target).number !== from) target = Math.max(target, headingTextStart(state, target));
  if (target !== head) view.dispatch({ selection: { anchor: target }, userEvent: "select", scrollIntoView: true });
  return true;
}

/** The start of a heading line is the start of its text. The marks beside it are reached with the arrow keys. */
function headingHome(view: EditorView): boolean {
  const { state } = view;
  const textStart = headingTextStart(state, state.selection.main.head);
  if (!oneCaret(state) || textStart < 0) return false;
  view.dispatch({ selection: { anchor: textStart }, userEvent: "select", scrollIntoView: true });
  return true;
}

export const lineKeys: KeyBinding[] = [
  { key: "Backspace", run: unheading },
  { key: "ArrowDown", run: (view) => stepLine(view, true) },
  { key: "ArrowUp", run: (view) => stepLine(view, false) },
  { key: "Home", run: headingHome },
  { mac: "Cmd-ArrowLeft", run: headingHome },
  { mac: "Ctrl-a", run: headingHome },
];
