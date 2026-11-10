import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import type { CodeToken } from "../render/highlight";
import { applyImageSize, knownImageSize } from "../render/image-sizes";
import { CALLOUT_ALIASES } from "../render/markdown";
import { MathWidget } from "./editor-blocks";

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;
const WIKILINK = /(?<!!)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
const EMBED = /!\[\[([^\]\n|#]+)(?:[|#][^\]\n]*)?\]\]|!\[[^\]\n]*\]\(([^)\s]+)\)/g;
const INLINE_MATH = /(?<![\\\d$])\$(?!\$)([^\s\\$]|\S.*?[^\s\\])\$(?![\d$])/g;
const HEADING = /^(?:ATX|Setext)Heading(\d)$/;
const INLINE_STYLE: Record<string, string> = { Emphasis: "cm-em", StrongEmphasis: "cm-strong", Strikethrough: "cm-strike" };
const HIDDEN_MARK = new Set(["EmphasisMark", "StrikethroughMark"]);
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);
const LIST = new Set(["BulletList", "OrderedList"]);
const TABLE_LINE = new Set(["TableHeader", "TableRow", "TableDelimiter"]);

export interface PreviewOptions {
  assetUrl: (target: string) => string | null;
  codeTokens: (code: string, lang: string) => CodeToken[] | null;
}

/** Asks for the preview to be drawn again, because something outside the document changed how it looks. */
export const redrawPreview = StateEffect.define<null>();

const WHOLE_CODE_BLOCK_LINES = 120;
const CODE_LINES_ABOVE_VIEW = 40;
const CODE_WINDOW_STEP = 20;

const hide = Decoration.replace({});
const CALLOUT_LINE = /^\s*(?:>\s*)+\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;
const KNOWN_CALLOUTS = new Set(["note", "abstract", "info", "tip", "success", "question", "warning", "failure", "danger"]);
const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });

class CalloutMark extends WidgetType {
  constructor(
    readonly kind: string,
    readonly type: string,
    readonly label: string,
  ) {
    super();
  }
  eq(other: CalloutMark): boolean {
    return other.kind === this.kind && other.type === this.type && other.label === this.label;
  }
  toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "callout cm-callout-mark";
    mark.dataset.callout = this.kind;
    mark.dataset.type = this.type;
    const icon = document.createElement("span");
    icon.className = "callout-icon";
    mark.append(icon, this.label);
    return mark;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    return span;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly url: string) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url;
  }
  toDOM(view: EditorView): HTMLElement {
    const image = document.createElement("img");
    image.className = "cm-embed-image";
    image.src = this.url;
    image.alt = "";
    const size = knownImageSize(this.url);
    if (size) applyImageSize(image, size);
    image.addEventListener("load", () => view.requestMeasure());
    return image;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly done: boolean) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.done === this.done;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = "task-box cm-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.done));
    return box;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export function frontmatterEnd(state: EditorState): number {
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 20_000));
  return FRONTMATTER.exec(head)?.[0].length ?? 0;
}

/** A note is shown as plain text in the file, so every position here is the real one. */
class Builder {
  readonly out: Range<Decoration>[] = [];
  private readonly state: EditorState;
  private readonly activeLines = new Set<number>();
  readonly frontmatterEnd: number;
  private readonly calloutLines = new Set<number>();

  constructor(
    private readonly view: EditorView,
    private readonly options: PreviewOptions,
  ) {
    this.state = view.state;
    if (view.hasFocus) {
      for (const range of this.state.selection.ranges) {
        const last = this.state.doc.lineAt(range.to).number;
        for (let n = this.state.doc.lineAt(range.from).number; n <= last; n++) this.activeLines.add(n);
      }
    }
    this.frontmatterEnd = frontmatterEnd(this.state);
  }

  private isActive(pos: number): boolean {
    return this.activeLines.has(this.state.doc.lineAt(pos).number);
  }

  private touchesSelection(from: number, to: number): boolean {
    return this.view.hasFocus && this.state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  }

  private lineClass(pos: number, cls: string): void {
    this.out.push(line(cls).range(this.state.doc.lineAt(pos).from));
  }

  private hideUnlessActive(from: number, to: number): void {
    if (from < to && !this.isActive(from)) this.out.push(hide.range(from, to));
  }

  /** Reveals a span's marks only when the cursor is at that span, so moving along a line doesn't shift it. */
  private hideUntilTouched(spanFrom: number, spanTo: number, from: number, to: number): void {
    if (from < to && !this.touchesSelection(spanFrom, spanTo)) this.out.push(hide.range(from, to));
  }

  /** Keeps a block's marks in the margin, so showing them never moves the text they belong to. */
  private hangMark(from: number, to: number): void {
    const glyphs = this.state.doc.sliceString(from, to).trimEnd().length;
    const cls = this.isActive(from) ? "cm-hang is-shown" : "cm-hang";
    this.out.push(Decoration.mark({ class: cls, attributes: { style: `--hang-ch: ${glyphs}` } }).range(from, to));
  }

  private withTrailingSpace(to: number): number {
    return this.state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
  }

  /** Empty lines stand in for the gap between blocks, so they take the height of that gap and not of a line of text. */
  blankLines(from: number, to: number): void {
    const { doc } = this.state;
    for (let pos = from; pos <= to; ) {
      const row = doc.lineAt(pos);
      if (row.from >= this.frontmatterEnd && !row.text.trim() && !this.inCode(row.from))
        this.out.push(line("cm-blank").range(row.from));
      pos = row.to + 1;
    }
  }

  frontmatter(): void {
    if (!this.frontmatterEnd) return;
    const last = this.state.doc.lineAt(Math.max(0, this.frontmatterEnd - 1)).number;
    for (let n = 1; n <= last; n++) this.out.push(line("cm-frontmatter").range(this.state.doc.line(n).from));
  }

  /** Decorates one syntax node. False stops the walk from going into its children. */
  node(ref: SyntaxNodeRef): boolean {
    if (ref.from < this.frontmatterEnd) return true;
    const { name, from, to } = ref;
    const heading = HEADING.exec(name);
    if (heading) this.lineClass(from, `cm-h${heading[1]}`);
    else if (INLINE_STYLE[name]) this.out.push(mark(INLINE_STYLE[name]).range(from, to));
    else if (HIDDEN_MARK.has(name)) this.hideUntilTouched(ref.node.parent?.from ?? from, ref.node.parent?.to ?? to, from, to);
    else if (name === "Link") return this.link(ref.node);
    else this.block(name, ref);
    return name !== "FencedCode" && name !== "InlineCode";
  }

  private block(name: string, ref: SyntaxNodeRef): void {
    const { from, to } = ref;
    const parent = ref.node.parent?.name ?? "";
    if (name === "Blockquote") this.callout(ref.node);
    else if (name === "HeaderMark") this.headerMark(parent, from, to);
    else if (name === "InlineCode") this.inlineCode(ref.node);
    else if (name === "FencedCode") this.fencedCode(ref.node);
    else if (name === "QuoteMark") this.quoteMark(from, to);
    else if (name === "ListMark") this.listMark(ref.node);
    else if (name === "TaskMarker") this.taskMarker(from, to);
    else if (name === "Image") this.out.push(mark("cm-syntax").range(from, to));
    else if (name === "URL" && parent !== "Link") this.out.push(mark("cm-link").range(from, to));
    else if (name === "HorizontalRule") this.rule(from, to);
    else if (TABLE_LINE.has(name)) this.lineClass(from, "cm-table-line");
  }

  private headerMark(parent: string, from: number, to: number): void {
    if (parent.startsWith("ATX")) this.hangMark(from, this.withTrailingSpace(to));
    else this.out.push(mark("cm-syntax").range(from, to));
  }

  private inlineCode(node: SyntaxNode): void {
    this.out.push(mark("cm-inline-code").range(node.from, node.to));
    for (const m of node.getChildren("CodeMark")) this.hideUntilTouched(node.from, node.to, m.from, m.to);
  }

  private fencedCode(node: SyntaxNode): void {
    const { doc } = this.state;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    let open = false;
    for (let n = first; n <= last; n++) if (this.activeLines.has(n)) open = true;
    for (let n = first; n <= last; n++) {
      const edge = n === first ? ` cm-code-first${open ? " cm-code-open" : ""}` : n === last ? " cm-code-last" : "";
      this.out.push(line(`cm-code-line${edge}`).range(doc.line(n).from));
    }
    if (!open) for (const m of node.getChildren("CodeMark")) this.out.push(hide.range(m.from, m.to));
    const info = node.getChild("CodeInfo");
    if (info) this.out.push(mark("cm-code-info").range(info.from, info.to));
    this.codeColours(node);
  }

  private codeColours(node: SyntaxNode): void {
    const info = node.getChild("CodeInfo");
    const text = node.getChild("CodeText");
    if (!info || !text || text.getChild("QuoteMark")) return;
    const { doc } = this.state;
    const lang = doc.sliceString(info.from, info.to).trim().split(/\s+/)[0].toLowerCase();
    const { from, to } = this.codeToColour(text);
    for (const token of this.options.codeTokens(doc.sliceString(from, to), lang) ?? []) {
      if (!token.style || token.from === token.to) continue;
      this.out.push(
        Decoration.mark({ class: "cm-code-token", attributes: { style: token.style } }).range(from + token.from, from + token.to),
      );
    }
  }

  /**
   * Colouring a long block on every keystroke is visibly slow, so only the part
   * on screen is coloured, with some lines above it to pick up the grammar's
   * state. Edges land on fixed steps so that scrolling reuses earlier work.
   */
  private codeToColour(text: SyntaxNode): { from: number; to: number } {
    const { doc } = this.state;
    const first = doc.lineAt(text.from).number;
    const last = doc.lineAt(text.to).number;
    if (last - first < WHOLE_CODE_BLOCK_LINES) return text;
    const { viewport } = this.view;
    const above = doc.lineAt(Math.max(viewport.from, text.from)).number - CODE_LINES_ABOVE_VIEW;
    const below = doc.lineAt(Math.min(viewport.to, text.to)).number;
    const start = Math.max(first, Math.floor(above / CODE_WINDOW_STEP) * CODE_WINDOW_STEP);
    const end = Math.min(last, Math.ceil(below / CODE_WINDOW_STEP) * CODE_WINDOW_STEP);
    return { from: Math.max(text.from, doc.line(start).from), to: Math.min(text.to, doc.line(end).to) };
  }

  /** A callout looks as it does in Read, and its marker appears only while the cursor is on it. */
  private callout(node: SyntaxNode): void {
    const { doc } = this.state;
    const first = doc.lineAt(node.from);
    const match = CALLOUT_LINE.exec(first.text);
    if (!match) return;
    const type = match[1].toLowerCase();
    const kind = CALLOUT_ALIASES[type] ?? type;
    const hue = KNOWN_CALLOUTS.has(kind) ? kind : "note";
    const last = doc.lineAt(node.to).number;
    for (let n = first.number; n <= last; n++) {
      this.calloutLines.add(n);
      const edges = `${n === first.number ? " cm-callout-first" : ""}${n === last ? " cm-callout-last" : ""}`;
      this.out.push(
        Decoration.line({ class: `cm-callout${edges}`, attributes: { style: `--c: var(--c-${hue})` } }).range(doc.line(n).from),
      );
    }
    const from = first.from + first.text.indexOf("[!");
    const to = first.to - match[3].length;
    if (this.touchesSelection(from, to)) return;
    const label = match[3] ? "" : type.charAt(0).toUpperCase() + type.slice(1);
    this.out.push(Decoration.replace({ widget: new CalloutMark(hue, type, label) }).range(from, to));
  }

  private quoteMark(from: number, to: number): void {
    if (!this.calloutLines.has(this.state.doc.lineAt(from).number)) this.lineClass(from, "cm-quote");
    this.hangMark(from, this.withTrailingSpace(to));
  }

  private listDepth(node: SyntaxNode): number {
    let depth = 0;
    for (let at: SyntaxNode | null = node; at; at = at.parent) if (LIST.has(at.name)) depth++;
    return depth;
  }

  private listMark(node: SyntaxNode): void {
    const { from, to } = node;
    const row = this.state.doc.lineAt(from);
    const task = node.nextSibling?.name === "Task" ? node.nextSibling.firstChild : null;
    const shown = this.withTrailingSpace(to);
    const end = task ? this.withTrailingSpace(task.to) : shown;
    this.out.push(
      Decoration.line({ class: "cm-list-line", attributes: { style: `--list-depth:${this.listDepth(node)}` } }).range(row.from),
    );
    if (this.touchesSelection(row.from, end)) return;
    if (row.from < from && /^\s*$/.test(this.state.doc.sliceString(row.from, from))) this.out.push(hide.range(row.from, from));
    if (node.parent?.parent?.name === "OrderedList") {
      this.out.push(mark("cm-list-number").range(from, to));
    } else if (task) {
      this.out.push(hide.range(from, shown));
    } else {
      this.out.push(Decoration.replace({ widget: new BulletWidget() }).range(from, shown));
    }
  }

  private taskMarker(from: number, to: number): void {
    const row = this.state.doc.lineAt(from);
    const end = this.withTrailingSpace(to);
    if (this.touchesSelection(row.from, end)) return;
    const done = this.state.doc.sliceString(from + 1, from + 2).toLowerCase() === "x";
    this.out.push(Decoration.replace({ widget: new TaskWidget(done) }).range(from, end));
    if (done) this.out.push(mark("cm-task-done").range(end, Math.max(end, row.to)));
  }

  /** A bracket pair with no URL is not a link here, because `[[target]]` and `[ ]` parse that way. */
  private link(node: SyntaxNode): boolean {
    const url = node.getChild("URL");
    const marks = node.getChildren("LinkMark");
    if (!url || marks.length < 2) return true;
    const label = [marks[0].to, marks[1].from] as const;
    if (label[0] < label[1]) {
      const href = this.state.doc.sliceString(url.from, url.to);
      this.out.push(Decoration.mark({ class: "cm-link", attributes: { "data-href": href } }).range(label[0], label[1]));
    }
    this.hideUntilTouched(node.from, node.to, marks[0].from, marks[0].to);
    this.hideUntilTouched(node.from, node.to, marks[1].from, node.to);
    return false;
  }

  private rule(from: number, to: number): void {
    this.lineClass(from, "cm-hr");
    this.hideUnlessActive(from, to);
  }

  wikilinks(from: number, to: number): void {
    const { doc } = this.state;
    for (let pos = from; pos <= to; ) {
      const row = doc.lineAt(pos);
      if (row.from >= this.frontmatterEnd) {
        this.wikilinksIn(row.from, row.text);
        this.embedsIn(row.from, row.text);
        this.mathIn(row.from, row.text);
      }
      pos = row.to + 1;
    }
  }

  private inCode(pos: number): boolean {
    for (let n: SyntaxNode | null = syntaxTree(this.state).resolveInner(pos, 1); n; n = n.parent)
      if (CODE.has(n.name)) return true;
    return false;
  }

  private embedsIn(start: number, text: string): void {
    for (const match of text.matchAll(EMBED)) {
      const at = start + match.index;
      if (this.touchesSelection(at, at + match[0].length) || this.inCode(at + 2)) continue;
      const url = this.options.assetUrl(match[1] ?? decodeURI(match[2]));
      if (url) this.out.push(Decoration.replace({ widget: new ImageWidget(url) }).range(at, at + match[0].length));
    }
  }

  private mathIn(start: number, text: string): void {
    if (!text.includes("$")) return;
    for (const match of text.matchAll(INLINE_MATH)) {
      const at = start + match.index;
      if (this.touchesSelection(at, at + match[0].length) || this.inCode(at + 1)) continue;
      this.out.push(Decoration.replace({ widget: new MathWidget(match[1], false) }).range(at, at + match[0].length));
    }
  }

  private wikilinksIn(start: number, text: string): void {
    for (const match of text.matchAll(WIKILINK)) {
      const at = start + match.index;
      if (this.inCode(at + 2)) continue;
      const [whole, target, heading = "", alias] = match;
      const end = at + whole.length;
      const samePageHeading = alias === undefined && !target && heading.startsWith("#");
      const shownFrom = alias === undefined ? at + 2 + (samePageHeading ? 1 : 0) : end - 2 - alias.length;
      const shownTo = alias === undefined ? at + 2 + target.length + heading.length : end - 2;
      if (shownFrom < shownTo) {
        const link = target + heading;
        this.out.push(Decoration.mark({ class: "cm-wikilink", attributes: { "data-wikilink": link } }).range(shownFrom, shownTo));
      }
      this.hideUntilTouched(at, end, at, shownFrom);
      this.hideUntilTouched(at, end, shownTo, end);
    }
  }
}

function build(view: EditorView, options: PreviewOptions): DecorationSet {
  const builder = new Builder(view, options);
  builder.frontmatter();
  for (const { from, to } of view.visibleRanges) {
    builder.blankLines(from, to);
    syntaxTree(view.state).iterate({ from, to, enter: (node) => builder.node(node) });
    builder.wikilinks(from, to);
  }
  return Decoration.set(builder.out, true);
}

/** Draws Markdown as it will read, showing the syntax only on the lines being edited. The text itself never changes. */
export function livePreview(options: PreviewOptions) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, options);
      }
      update(update: ViewUpdate): void {
        const treeMoved = syntaxTree(update.startState) !== syntaxTree(update.state);
        const asked = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(redrawPreview)));
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || treeMoved || asked) {
          this.decorations = build(update.view, options);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
