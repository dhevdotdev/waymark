import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, placeholder, showTooltip, type Tooltip, tooltips, ViewPlugin } from "@codemirror/view";
import { previewBlocks } from "./editor-blocks";
import { drawnCaret } from "./editor-caret";
import { findPanel } from "./editor-find";
import { editorFolds, type FoldAction, type FoldOptions, foldAction, foldSaved } from "./editor-folds";
import { editorInsert, type InsertOptions, pastePlain } from "./editor-insert";
import { lineKeys } from "./editor-keys";
import { icons } from "./icons";
import { frontmatterEnd, livePreview, type PreviewOptions, redrawPreview } from "./live-preview";
import { bindRoving, setStop } from "./roving";
import { tableEditor } from "./table-editor";

export { prepareEditorMath } from "./editor-blocks";

const STATUS_BAR_ROOM = 34;
const BUBBLE_GAP = { x: 0, y: 6 };

const External = Annotation.define<boolean>();
const GRAMMAR_WAIT_MS = 400;
const ALIGN_FRAMES = 6;
const CARET_MARGIN_TOP = 96;
const CARET_MARGIN_BOTTOM = 0.3;

export interface EditorStats {
  line: number;
  column: number;
  words: number;
  selected: number;
}

export interface EditorOptions extends InsertOptions, PreviewOptions, FoldOptions {
  /** Loads code grammars the text needs. Resolves true if any were new. */
  prepareCode: (text: string) => Promise<boolean>;
  text: string;
  lineSeparator: string;
  onChange: (text: string) => void;
  onStats: (stats: EditorStats) => void;
  openWikilink: (target: string, newTab: boolean) => void;
  openUrl: (url: string) => void;
  renderInline: (text: string) => DocumentFragment;
}

export interface EditorHandle {
  focus(): void;
  find(): void;
  replace(text: string): void;
  /** Changes the text as one undo step, as if typed. False when the editor is frozen. */
  change(text: string): boolean;
  /** Moves the cursor onto a line, revealing it if it was folded away. */
  revealLine(line: number): void;
  placeCursorAt(x: number, y: number): void;
  /** Turns the selected text into a link, as the formatting bubble does. False when nothing is selected here. */
  linkSelection(): boolean;
  /** Folds or unfolds sections under headings. */
  fold(action: FoldAction): boolean;
  /** Stops typing while text is being moved somewhere safe. */
  setFrozen(frozen: boolean): void;
  /** Draws again after code colours changed. */
  redraw(): void;
  /** The 0-based line at the top of `scroller`, and how far below its top edge that line sits. */
  topLine(scroller: HTMLElement): { line: number; offset: number };
  /** Scrolls so a 0-based line sits `offset` pixels below the top of `scroller`. */
  showLine(scroller: HTMLElement, line: number, offset: number): void;
  destroy(): void;
}

/** Space above a line's text that the editor counts as part of the line, as headings have and rendered blocks do not. */
function lineInset(view: EditorView, at: number): number {
  const { node } = view.domAtPos(at);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const line = element?.closest(".cm-line");
  return line ? Number.parseFloat(getComputedStyle(line).paddingTop) || 0 : 0;
}

/** Applies only the part of the text that differs, so the cursor and everything around the change stay put. */
function swapText(view: EditorView, text: string, annotations: TransactionSpec["annotations"]): void {
  const next = text.replace(/\r\n/g, "\n");
  const current = view.state.doc.toString();
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let tail = 0;
  while (
    tail < current.length - start &&
    tail < next.length - start &&
    current[current.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }
  view.dispatch({
    changes: { from: start, to: current.length - tail, insert: next.slice(start, next.length - tail) },
    annotations,
  });
}

function wrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const size = marker.length;
      const wrapped =
        state.sliceDoc(range.from - size, range.from) === marker && state.sliceDoc(range.to, range.to + size) === marker;
      if (wrapped) {
        return {
          changes: [
            { from: range.from - size, to: range.from },
            { from: range.to, to: range.to + size },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    }),
  );
  view.focus();
  return true;
}

function addLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const urlAt = to + 3;
  view.dispatch({
    changes: [
      { from, insert: "[" },
      { from: to, insert: "](url)" },
    ],
    selection: EditorSelection.range(urlAt, urlAt + 3),
  });
  view.focus();
  return true;
}

function prefixLines(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const first = state.doc.lineAt(state.selection.main.from).number;
  const last = state.doc.lineAt(state.selection.main.to).number;
  const changes = [];
  for (let n = first; n <= last; n++) {
    const row = state.doc.line(n);
    if (row.text.startsWith(prefix)) changes.push({ from: row.from, to: row.from + prefix.length });
    else changes.push({ from: row.from, insert: prefix });
  }
  view.dispatch({ changes });
  view.focus();
  return true;
}

const BUBBLE: [face: string, title: string, run: (view: EditorView) => boolean][] = [
  ["B", "Bold", (v) => wrap(v, "**")],
  ["I", "Italic", (v) => wrap(v, "*")],
  ["S", "Strikethrough", (v) => wrap(v, "~~")],
  [icons.code, "Inline code", (v) => wrap(v, "`")],
  [icons.link, "Link", addLink],
  [icons.quote, "Quote", (v) => prefixLines(v, "> ")],
];

const showBubble = StateEffect.define<boolean>();

function bubbleFor(state: EditorState): Tooltip | null {
  const range = state.selection.main;
  if (range.empty) return null;
  return {
    pos: range.from,
    above: true,
    arrow: false,
    create() {
      const dom = document.createElement("div");
      dom.className = "edit-bubble";
      dom.setAttribute("role", "toolbar");
      dom.setAttribute("aria-label", "Format selection");
      return { dom, offset: BUBBLE_GAP };
    },
  };
}

/**
 * Keeps the line being written away from the window's edges. This is not done
 * with CodeMirror's scroll margins, because it hides any tooltip inside them,
 * which took the selection toolbar and the slash menu away near the edges.
 */
const caretRoom = EditorView.updateListener.of((update) => {
  const fromKeys = update.transactions.some(
    (tr) =>
      tr.isUserEvent("input") ||
      tr.isUserEvent("delete") ||
      (tr.isUserEvent("select") && !tr.isUserEvent("select.pointer") && !tr.isUserEvent("select.search")),
  );
  const scroller = update.view.dom.closest<HTMLElement>(".scroller");
  if (!fromKeys || !scroller || !update.view.hasFocus) return;
  update.view.requestMeasure({
    read: (view) => view.coordsAtPos(view.state.selection.main.head),
    write: (caret) => {
      if (!caret) return;
      const box = scroller.getBoundingClientRect();
      const below = caret.bottom - (box.bottom - window.innerHeight * CARET_MARGIN_BOTTOM);
      const above = box.top + CARET_MARGIN_TOP - caret.top;
      if (below > 0) scroller.scrollTop += below;
      else if (above > 0) scroller.scrollTop -= above;
    },
  });
});

/** Offered once a mouse selection is finished, so it never trails the pointer or interrupts someone selecting by keyboard. */
const bubbleField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(showBubble)) return effect.value ? bubbleFor(tr.state) : null;
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.compute([field], (state) => state.field(field)),
});

const bubbleAfterPointer = ViewPlugin.define((view) => {
  const finish = () => view.dispatch({ effects: showBubble.of(true) });
  const start = (event: MouseEvent) => {
    if (event.button === 0 && !(event.target as HTMLElement).closest(".cm-table-widget, .cm-tooltip"))
      window.addEventListener("mouseup", finish, { once: true });
  };
  view.contentDOM.addEventListener("mousedown", start);
  return {
    destroy() {
      view.contentDOM.removeEventListener("mousedown", start);
      window.removeEventListener("mouseup", finish);
    },
  };
});

const bubbleButtons = EditorView.updateListener.of((update) => {
  for (const dom of update.view.dom.querySelectorAll<HTMLElement>(".edit-bubble:empty")) {
    for (const [face, title, run] of BUBBLE) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = face;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.className = `edit-bubble-btn is-${title.split(" ")[0].toLowerCase()}`;
      setStop(button, !dom.childElementCount);
      button.addEventListener("mousedown", (e) => {
        e.preventDefault();
        run(update.view);
      });
      /* The pointer acts on press, so the selection is still there; a click with no press came from the keyboard. */
      button.addEventListener("click", (e) => {
        if (e.detail === 0) run(update.view);
      });
      dom.append(button);
    }
    bindRoving(dom, { items: () => [...dom.querySelectorAll<HTMLElement>(".edit-bubble-btn")] });
  }
});

function toggleTaskAt(view: EditorView, box: HTMLElement): void {
  const pos = view.posAtDOM(box);
  const done = box.getAttribute("aria-checked") === "true";
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: done ? " " : "x" } });
}

function clickHandlers(options: EditorOptions): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      const box = target.closest<HTMLElement>(".cm-task");
      if (box) {
        event.preventDefault();
        toggleTaskAt(view, box);
        return true;
      }
      if (!event.metaKey) return false;
      const wiki = target.closest<HTMLElement>("[data-wikilink]");
      if (wiki) {
        event.preventDefault();
        options.openWikilink(wiki.dataset.wikilink!, event.shiftKey);
        return true;
      }
      const link = target.closest<HTMLElement>("[data-href]");
      if (link && /^(?:https?:|mailto:)/i.test(link.dataset.href!)) {
        event.preventDefault();
        options.openUrl(link.dataset.href!);
        return true;
      }
      return false;
    },
  });
}

function stats(state: EditorState): EditorStats {
  const head = state.selection.main.head;
  const row = state.doc.lineAt(head);
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  const { from, to } = state.selection.main;
  return {
    line: row.number,
    column: head - row.from + 1,
    words: words(state.doc.toString()),
    selected: words(state.sliceDoc(from, to)),
  };
}

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  const editable = new Compartment();
  let focusedBeforeFreeze = false;
  let grammarWait: ReturnType<typeof setTimeout> | undefined;
  const blocks = previewBlocks(frontmatterEnd);
  const redraw = () => view.dispatch({ effects: redrawPreview.of(null) });
  const loadGrammars = () => {
    options
      .prepareCode(view.state.sliceDoc())
      .then((loaded) => {
        if (loaded && view.dom.isConnected) redraw();
      })
      .catch((error: unknown) => console.warn("Code colours not loaded", error));
  };
  const frozenState = (frozen: boolean): Extension => [EditorState.readOnly.of(frozen), EditorView.editable.of(!frozen)];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        EditorState.lineSeparator.of(options.lineSeparator),
        editable.of(frozenState(false)),
        history(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        livePreview(options),
        editorFolds(options),
        blocks.extension,
        editorInsert(options),
        tableEditor({ renderInline: options.renderInline, openWikilink: options.openWikilink, frontmatterEnd }),
        search({ top: true, createPanel: findPanel }),
        tooltips({
          tooltipSpace: (v) => {
            const box = v.dom.ownerDocument.documentElement.getBoundingClientRect();
            return {
              top: box.top,
              left: box.left,
              right: box.right,
              bottom: box.bottom - STATUS_BAR_ROOM,
              x: 0,
              y: 0,
              width: box.width,
              height: box.height - STATUS_BAR_ROOM,
              toJSON: () => null,
            };
          },
        }),
        bubbleField,
        bubbleAfterPointer,
        bubbleButtons,
        placeholder("Start writing, or type / for blocks"),
        drawnCaret(),
        caretRoom,
        clickHandlers(options),
        keymap.of([
          { key: "Mod-Shift-v", run: pastePlain },
          { key: "Mod-b", run: (v) => wrap(v, "**") },
          { key: "Mod-i", run: (v) => wrap(v, "*") },
          ...searchKeymap.filter((binding) => binding.key === "Escape" || binding.key === "Mod-g"),
          ...lineKeys,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Note text" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
            options.onChange(update.state.sliceDoc());
          }
          if (update.docChanged) {
            clearTimeout(grammarWait);
            grammarWait = setTimeout(loadGrammars, GRAMMAR_WAIT_MS);
          }
          if (update.docChanged || update.selectionSet) options.onStats(stats(update.state));
        }),
      ],
    }),
  });
  foldSaved(view, options.folded);
  options.onStats(stats(view.state));
  /* CodeMirror's find bar only searches again when a key is released, so a held Backspace left old matches lit. */
  return {
    focus: () => view.focus(),
    find: () => openSearchPanel(view),
    replace: (text) => swapText(view, text, External.of(true)),
    change(text) {
      if (view.state.readOnly) return false;
      swapText(view, text, isolateHistory.of("full"));
      return true;
    },
    revealLine(line) {
      const at = view.state.doc.line(Math.min(view.state.doc.lines, line + 1)).from;
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      view.focus();
    },
    placeCursorAt(x, y) {
      view.dispatch({ selection: { anchor: blocks.outsideBlocks(view.state, view.posAtCoords({ x, y }, false)) } });
    },
    linkSelection() {
      return !view.state.selection.main.empty && view.hasFocus && !view.state.readOnly && addLink(view);
    },
    fold(action) {
      foldAction(view, action);
      return true;
    },
    setFrozen(frozen) {
      if (frozen) focusedBeforeFreeze = view.hasFocus;
      view.dispatch({ effects: editable.reconfigure(frozenState(frozen)) });
      if (!frozen && focusedBeforeFreeze) view.focus();
    },
    redraw,
    topLine(scroller) {
      const { doc } = view.state;
      const top = scroller.getBoundingClientRect().top;
      let line = doc.lineAt(view.lineBlockAtHeight(top - view.documentTop).from);
      /* A gap between blocks is not a place in the note, so the first text at or below the edge stands for it. */
      while (!line.text.trim() && line.number < doc.lines) line = doc.line(line.number + 1);
      const block = view.lineBlockAt(line.from);
      return { line: line.number - 1, offset: view.documentTop + block.top + lineInset(view, line.from) - top };
    },
    showLine(scroller, line, offset) {
      const { doc } = view.state;
      const at = doc.line(Math.min(doc.lines, line + 1)).from;
      /* Heights off screen are estimates until drawn, so the first jump lands close and the next frames correct it. */
      const align = (frames: number) => {
        const top = view.lineBlockAt(at).top + lineInset(view, at);
        const off = view.documentTop + top - scroller.getBoundingClientRect().top - offset;
        scroller.scrollTop += off;
        if (frames > 0 && !view.composing) requestAnimationFrame(() => align(frames - 1));
      };
      align(ALIGN_FRAMES);
    },
    destroy() {
      clearTimeout(grammarWait);
      view.destroy();
    },
  };
}
