import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { frontmatterEnd, livePreview } from "./live-preview";
import { tableEditor } from "./table-editor";

const External = Annotation.define<boolean>();

export interface EditorStats {
  line: number;
  column: number;
  words: number;
}

export interface EditorOptions {
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

const BUBBLE: [label: string, title: string, run: (view: EditorView) => boolean][] = [
  ["B", "Bold", (v) => wrap(v, "**")],
  ["I", "Italic", (v) => wrap(v, "*")],
  ["S", "Strikethrough", (v) => wrap(v, "~~")],
  ["Code", "Inline code", (v) => wrap(v, "`")],
  ["Link", "Link", addLink],
  ["Quote", "Quote", (v) => prefixLines(v, "> ")],
];

function selectionBubble(state: EditorState): Tooltip | null {
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

const bubbleField = StateField.define<Tooltip | null>({
  create: selectionBubble,
  update: (value, tr: Transaction) => (tr.docChanged || tr.selection ? selectionBubble(tr.state) : value),
  provide: (field) => showTooltip.compute([field], (state) => state.field(field)),
});

const bubbleButtons = EditorView.updateListener.of((update) => {
  for (const dom of update.view.dom.querySelectorAll<HTMLElement>(".edit-bubble:empty")) {
    for (const [label, title, run] of BUBBLE) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
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
  return { line: row.number, column: head - row.from + 1, words: state.doc.toString().split(/\s+/).filter(Boolean).length };
}

export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  const editable = new Compartment();
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
        livePreview,
        tableEditor({ renderInline: options.renderInline, openWikilink: options.openWikilink, frontmatterEnd }),
        search({ top: true }),
        bubbleField,
        bubbleButtons,
        clickHandlers(options),
        keymap.of([
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
          if (update.docChanged || update.selectionSet) options.onStats(stats(update.state));
        }),
      ],
    }),
  });
  options.onStats(stats(view.state));
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
      const pos = view.posAtCoords({ x, y }, false);
      view.dispatch({ selection: { anchor: pos } });
    },
    setFrozen: (frozen) => view.dispatch({ effects: editable.reconfigure(frozenState(frozen)) }),
    destroy: () => view.destroy(),
  };
}
