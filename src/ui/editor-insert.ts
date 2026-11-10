import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { native } from "../platform";
import { showContextMenu } from "./context-menu";
import { frontmatterEnd } from "./live-preview";
import { htmlToMarkdown, isCodeEditorCopy } from "./paste-html";
import { focusTableAt } from "./table-editor";

export interface LinkOption {
  label: string;
  target: string;
  detail?: string;
}

export interface InsertOptions {
  linkTargets: (embed: boolean) => LinkOption[];
  headingsOf: (target: string) => string[];
  addFile: (file: File) => Promise<string | null>;
  today: () => string;
}

const IN_CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "Table"]);
const TABLE = ["|  |  |  |", "| --- | --- | --- |", "|  |  |  |", "|  |  |  |"];

function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (IN_CODE.has(node.name)) return true;
  }
  return false;
}

/** Puts lines in place of the typed `/word`, with a blank line either side when a block needs one to count as a block. */
function insertBlock(
  view: EditorView,
  from: number,
  to: number,
  lines: string[],
  caretLine: number,
  caretColumn: number,
  spaced = false,
): number {
  const { state } = view;
  const row = state.doc.lineAt(from);
  const before = spaced && row.number > 1 && state.doc.line(row.number - 1).text.trim() !== "";
  const after = spaced && row.number < state.doc.lines && state.doc.line(row.number + 1).text.trim() !== "";
  const all = [...(before ? [""] : []), ...lines, ...(after ? [""] : [])];
  const target = caretLine + (before ? 1 : 0);
  const caret = from + all.slice(0, target).reduce((sum, line) => sum + line.length + 1, 0) + caretColumn;
  view.dispatch({
    changes: { from, to, insert: all.join(state.lineBreak) },
    selection: { anchor: caret },
    userEvent: "input.complete",
  });
  return from + (before ? 1 : 0);
}

const holdPlace = StateEffect.define<{ id: number; pos: number }>();
const releasePlace = StateEffect.define<number>();
let nextPlace = 0;

/** Places waiting for a file to finish saving, kept correct as the note is typed in meanwhile. */
const heldPlaces = StateField.define<Map<number, number>>({
  create: () => new Map(),
  update(places, tr) {
    const next = new Map([...places].map(([id, pos]) => [id, tr.changes.mapPos(pos, 1)]));
    for (const effect of tr.effects) {
      if (effect.is(holdPlace)) next.set(effect.value.id, effect.value.pos);
      if (effect.is(releasePlace)) next.delete(effect.value);
    }
    return next;
  },
});

/** Saves files and embeds them at `at`, following that spot if the note changes while they save. */
function insertFiles(view: EditorView, files: File[], at: number, options: InsertOptions): void {
  const id = nextPlace++;
  view.dispatch({ effects: holdPlace.of({ id, pos: at }) });
  void (async () => {
    for (const file of files) {
      const embed = await options.addFile(file);
      const pos = view.state.field(heldPlaces).get(id);
      if (embed && pos !== undefined) view.dispatch({ changes: { from: pos, insert: embed } });
    }
    view.dispatch({ effects: releasePlace.of(id) });
  })();
}

function pickFile(view: EditorView, from: number, to: number, options: InsertOptions): void {
  view.dispatch({ changes: { from, to } });
  const id = nextPlace++;
  view.dispatch({ effects: holdPlace.of({ id, pos: from }) });
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.addEventListener("change", () => {
    const pos = view.state.field(heldPlaces).get(id) ?? from;
    view.dispatch({ effects: releasePlace.of(id) });
    if (input.files?.[0]) insertFiles(view, [input.files[0]], pos, options);
  });
  input.click();
}

type Apply = (view: EditorView, from: number, to: number, options: InsertOptions) => void;

const lineStart =
  (text: string): Apply =>
  (view, from, to) => {
    insertBlock(view, from, to, [text], 0, text.length);
  };

/** Each block is shown by the Markdown that makes it. */
const BLOCK_GLYPHS: Record<string, string> = {
  "Heading 1": "#",
  "Heading 2": "##",
  "Heading 3": "###",
  "Bulleted list": "-",
  "Numbered list": "1.",
  Task: "[ ]",
  Quote: ">",
  Table: "|",
  "Code block": "```",
  Callout: "[!]",
  Diagram: "->",
  "Math block": "$$",
  Divider: "---",
  "Link to a note": "[[",
};

function blockGlyph(completion: Completion): HTMLElement | null {
  const glyph = BLOCK_GLYPHS[completion.displayLabel ?? ""];
  if (!glyph) return null;
  const tile = document.createElement("span");
  tile.className = "cm-block-glyph";
  tile.textContent = glyph;
  return tile;
}

const BLOCKS: [label: string, keywords: string, apply: Apply][] = [
  ["Heading 1", "title h1", lineStart("# ")],
  ["Heading 2", "h2", lineStart("## ")],
  ["Heading 3", "h3", lineStart("### ")],
  ["Bulleted list", "ul unordered", lineStart("- ")],
  ["Numbered list", "ol ordered", lineStart("1. ")],
  ["Task", "todo checkbox", lineStart("- [ ] ")],
  ["Quote", "blockquote", lineStart("> ")],
];

const WHOLE_LINE: [label: string, keywords: string, apply: Apply][] = [
  [
    "Table",
    "grid rows columns",
    (view, from, to) => {
      const at = insertBlock(view, from, to, TABLE, 0, 0, true);
      requestAnimationFrame(() => focusTableAt(view, at));
    },
  ],
  ["Code block", "fence snippet", (view, from, to) => void insertBlock(view, from, to, ["```", "", "```"], 1, 0, true)],
  ["Callout", "note admonition", (view, from, to) => void insertBlock(view, from, to, ["> [!note]", "> "], 1, 2, true)],
  [
    "Diagram",
    "mermaid flowchart",
    (view, from, to) => void insertBlock(view, from, to, ["```mermaid", "flowchart TD", "  A --> B", "```"], 1, 12, true),
  ],
  ["Math block", "equation latex", (view, from, to) => void insertBlock(view, from, to, ["$$", "", "$$"], 1, 0, true)],
  ["Divider", "rule horizontal hr", (view, from, to) => void insertBlock(view, from, to, ["---", ""], 1, 0, true)],
];

const INLINE: [label: string, keywords: string, apply: Apply][] = [
  [
    "Link to a note",
    "wikilink",
    (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "[[]]" }, selection: { anchor: from + 2 } });
      startCompletion(view);
    },
  ],
  [
    "Web link",
    "url",
    (view, from, to) => {
      view.dispatch({ changes: { from, to, insert: "[text](url)" }, selection: EditorSelection.range(from + 1, from + 5) });
    },
  ],
  ["Image or file", "picture attachment pdf upload", (view, from, to, options) => pickFile(view, from, to, options)],
  [
    "Today's date",
    "now day",
    (view, from, to, options) => {
      const date = options.today();
      view.dispatch({ changes: { from, to, insert: date }, selection: { anchor: from + date.length } });
    },
  ],
];

function slashSource(options: InsertOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const typed = context.matchBefore(/(?:^|\s)\/[\w-]*$/);
    if (!typed) return null;
    const slash = typed.from + typed.text.indexOf("/");
    const { state } = context;
    if (inCode(state, slash)) return null;
    const row = state.doc.lineAt(slash);
    const atStart = state.sliceDoc(row.from, slash).trim() === "";
    const restBlank = state.sliceDoc(context.pos, row.to).trim() === "";
    const items = [...(atStart ? BLOCKS : []), ...(atStart && restBlank ? WHOLE_LINE : []), ...INLINE];
    const entry = ([label, keywords, apply]: (typeof BLOCKS)[number], position: number): Completion => ({
      label: `${label} ${keywords}`,
      displayLabel: label,
      boost: 99 - position,
      apply: (view, _completion, _from, to) => apply(view, slash, to, options),
    });
    /* Filtered here rather than by the fuzzy ranking, so a block keeps its place in the list as you type. */
    const query = state.sliceDoc(slash + 1, context.pos).toLowerCase();
    const shown = items.filter(([label, keywords]) => `${label} ${keywords}`.toLowerCase().includes(query));
    return { from: slash + 1, options: shown.map(entry), filter: false };
  };
}

function linkSource(options: InsertOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const typed = context.matchBefore(/!?\[\[[^\]\n|]*$/);
    if (!typed) return null;
    const { state } = context;
    if (inCode(state, typed.from + 1)) return null;
    const embed = typed.text.startsWith("!");
    const start = typed.from + (embed ? 3 : 2);
    const close = (view: EditorView, from: number, to: number, text: string) => {
      const end = state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
      view.dispatch({ changes: { from, to: end, insert: `${text}]]` }, selection: { anchor: from + text.length + 2 } });
    };
    const hash = typed.text.indexOf("#");
    if (hash >= 0) {
      const from = typed.from + hash + 1;
      return {
        from,
        options: options.headingsOf(typed.text.slice(embed ? 3 : 2, hash)).map((label) => ({
          label,
          apply: (view: EditorView, _c: Completion, f: number, t: number) => close(view, f, t, label),
        })),
        validFor: /^[^\]\n|]*$/,
      };
    }
    return {
      from: start,
      options: options.linkTargets(embed).map(({ label, target, detail }) => ({
        label,
        detail,
        apply: (view: EditorView, _c: Completion, f: number, t: number) => close(view, f, t, target),
      })),
      validFor: /^[^\]\n|#]*$/,
    };
  };
}

const URL_ONLY = /^https?:\/\/\S+$/;

function insertAsOneStep(view: EditorView, text: string): void {
  view.dispatch({
    ...view.state.replaceSelection(text),
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

/** Keeps blocks on their own lines when they land in the middle of existing text. */
function padded(view: EditorView, markdown: string): string {
  const { from, to } = view.state.selection.main;
  if (!/\n\n|^(#{1,6} |[-*] |\d+\. |> |\||```)/.test(markdown)) return markdown;
  const before = view.state.sliceDoc(view.state.doc.lineAt(from).from, from);
  const after = view.state.sliceDoc(to, view.state.doc.lineAt(to).to);
  return `${before.trim() ? "\n\n" : ""}${markdown}${after.trim() ? "\n\n" : ""}`;
}

function pasteHtml(event: ClipboardEvent, view: EditorView): boolean {
  const html = event.clipboardData?.getData("text/html");
  if (!html || view.state.selection.main.from < frontmatterEnd(view.state)) return false;
  if (inCode(view.state, view.state.selection.main.from)) return false;
  if (isCodeEditorCopy([...(event.clipboardData?.types ?? [])], html)) return false;
  const markdown = htmlToMarkdown(html);
  if (!markdown) return false;
  event.preventDefault();
  insertAsOneStep(view, padded(view, markdown));
  return true;
}

/** ⌘⇧V: the clipboard's plain text, ignoring anything richer it also holds. */
export function pastePlain(view: EditorView): boolean {
  void native.clipboardText().then((text) => {
    if (text) insertAsOneStep(view, text.replace(/\r\n/g, "\n"));
  });
  return true;
}

function fileHandlers(options: InsertOptions): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        insertFiles(view, files, view.state.selection.main.from, options);
        return true;
      }
      const text = event.clipboardData?.getData("text/plain").trim() ?? "";
      const { from, to, empty } = view.state.selection.main;
      if (empty || !URL_ONLY.test(text)) return pasteHtml(event, view);
      event.preventDefault();
      view.dispatch({
        changes: [
          { from, insert: "[" },
          { from: to, insert: `](${text})` },
        ],
        selection: { anchor: to + text.length + 4 },
      });
      return true;
    },
    drop(event, view) {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!files.length) return false;
      event.preventDefault();
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      insertFiles(view, files, at, options);
      return true;
    },
  });
}

/** Everything that puts something new into a note: the `/` menu, `[[` links, and pasted or dropped files. */
export function editorInsert(options: InsertOptions): Extension {
  return [
    autocompletion({
      override: [slashSource(options), linkSource(options)],
      icons: false,
      addToOptions: [{ render: blockGlyph, position: 20 }],
      selectOnOpen: true,
    }),
    heldPlaces,
    fileHandlers(options),
    EditorView.domEventHandlers({
      contextmenu(e, view) {
        const line = (e.target as HTMLElement).closest(".cm-line");
        const pos = line ? view.posAtCoords({ x: e.clientX, y: e.clientY }, false) : null;
        if (pos === null) return false;
        const { from, to, text } = view.state.doc.lineAt(pos);
        if (text.trim()) return false;
        e.preventDefault();
        showContextMenu(
          e.clientX,
          e.clientY,
          WHOLE_LINE.map(([label, , apply]) => ({ label, run: () => apply(view, from, to, options) })),
        );
        return true;
      },
    }),
  ];
}
