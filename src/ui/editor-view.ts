import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
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
} from "@codemirror/state";
import { EditorView, keymap, placeholder, showTooltip, type Tooltip, tooltips, ViewPlugin } from "@codemirror/view";
import { previewBlocks } from "./editor-blocks";
import { findPanel } from "./editor-find";
import { editorInsert, type InsertOptions, pastePlain } from "./editor-insert";
import { icons } from "./icons";
import { frontmatterEnd, livePreview, type PreviewOptions, redrawPreview } from "./live-preview";
import { tableEditor } from "./table-editor";

const STATUS_BAR_ROOM = 34;

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

export interface EditorOptions extends InsertOptions, PreviewOptions {
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
  placeCursorAt(x: number, y: number): void;
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
      return { dom };
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
      tr.isUserEvent("input") || tr.isUserEvent("delete") || (tr.isUserEvent("select") && !tr.isUserEvent("select.pointer")),
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
      button.addEventListener("mousedown", (e) => {
        e.preventDefault();
        run(update.view);
      });
      dom.append(button);
    }
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
        caretRoom,
        clickHandlers(options),
        keymap.of([
          { key: "Mod-Shift-v", run: pastePlain },
          { key: "Mod-b", run: (v) => wrap(v, "**") },
          { key: "Mod-i", run: (v) => wrap(v, "*") },
          ...searchKeymap.filter((binding) => binding.key === "Escape" || binding.key === "Mod-g"),
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
  options.onStats(stats(view.state));
  /* CodeMirror's find bar only searches again when a key is released, so a held Backspace left old matches lit. */
  return {
    focus: () => view.focus(),
    find: () => openSearchPanel(view),
    replace(text) {
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
        annotations: External.of(true),
      });
    },
    placeCursorAt(x, y) {
      view.dispatch({ selection: { anchor: blocks.outsideBlocks(view.state, view.posAtCoords({ x, y }, false)) } });
    },
    setFrozen(frozen) {
      if (frozen) focusedBeforeFreeze = view.hasFocus;
      view.dispatch({ effects: editable.reconfigure(frozenState(frozen)) });
      if (!frozen && focusedBeforeFreeze) view.focus();
    },
    redraw,
    topLine(scroller) {
      const top = scroller.getBoundingClientRect().top;
      const block = view.lineBlockAtHeight(top - view.documentTop);
      return { line: view.state.doc.lineAt(block.from).number - 1, offset: view.documentTop + block.top - top };
    },
    showLine(scroller, line, offset) {
      const { doc } = view.state;
      const at = doc.line(Math.min(doc.lines, line + 1)).from;
      /* Heights off screen are estimates until drawn, so the first jump lands close and the next frames correct it. */
      const align = (frames: number) => {
        const off = view.documentTop + view.lineBlockAt(at).top - scroller.getBoundingClientRect().top - offset;
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
