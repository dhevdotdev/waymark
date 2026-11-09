import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/;
const WIKILINK = /(?<!!)\[\[([^\]\n|#]*)(#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
const HEADING = /^(?:ATX|Setext)Heading(\d)$/;
const INLINE_STYLE: Record<string, string> = { Emphasis: "cm-em", StrongEmphasis: "cm-strong", Strikethrough: "cm-strike" };
const HIDDEN_MARK = new Set(["EmphasisMark", "StrikethroughMark"]);
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText"]);
const LIST = new Set(["BulletList", "OrderedList"]);
const TABLE_LINE = new Set(["TableHeader", "TableRow", "TableDelimiter"]);

const hide = Decoration.replace({});
const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    return span;
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

  constructor(private readonly view: EditorView) {
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

  private withTrailingSpace(to: number): number {
    return this.state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
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
    else if (HIDDEN_MARK.has(name)) this.hideUnlessActive(from, to);
    else if (name === "Link") return this.link(ref.node);
    else this.block(name, ref);
    return name !== "FencedCode" && name !== "InlineCode";
  }

  private block(name: string, ref: SyntaxNodeRef): void {
    const { from, to } = ref;
    const parent = ref.node.parent?.name ?? "";
    if (name === "HeaderMark") this.headerMark(parent, from, to);
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
    if (parent.startsWith("ATX")) this.hideUnlessActive(from, this.withTrailingSpace(to));
    else this.out.push(mark("cm-syntax").range(from, to));
  }

  private inlineCode(node: SyntaxNode): void {
    this.out.push(mark("cm-inline-code").range(node.from, node.to));
    for (const m of node.getChildren("CodeMark")) this.hideUnlessActive(m.from, m.to);
  }

  private fencedCode(node: SyntaxNode): void {
    const { doc } = this.state;
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    let open = false;
    for (let n = first; n <= last; n++) {
      if (this.activeLines.has(n)) open = true;
      const edge = n === first ? " cm-code-first" : n === last ? " cm-code-last" : "";
      this.out.push(line(`cm-code-line${edge}`).range(doc.line(n).from));
    }
    if (!open) for (const m of node.getChildren("CodeMark")) this.out.push(hide.range(m.from, m.to));
    const info = node.getChild("CodeInfo");
    if (info) this.out.push(mark("cm-code-info").range(info.from, info.to));
  }

  private quoteMark(from: number, to: number): void {
    this.lineClass(from, "cm-quote");
    this.hideUnlessActive(from, this.withTrailingSpace(to));
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
    this.hideUnlessActive(marks[0].from, marks[0].to);
    this.hideUnlessActive(marks[1].from, node.to);
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
      if (row.from >= this.frontmatterEnd) this.wikilinksIn(row.from, row.text);
      pos = row.to + 1;
    }
  }

  private wikilinksIn(start: number, text: string): void {
    const tree = syntaxTree(this.state);
    for (const match of text.matchAll(WIKILINK)) {
      const at = start + match.index;
      let inCode = false;
      for (let n: SyntaxNode | null = tree.resolveInner(at + 2, 1); n; n = n.parent) if (CODE.has(n.name)) inCode = true;
      if (inCode) continue;
      const [whole, target, heading = "", alias] = match;
      const end = at + whole.length;
      const shownFrom = alias === undefined ? at + 2 : end - 2 - alias.length;
      const shownTo = alias === undefined ? at + 2 + target.length + heading.length : end - 2;
      if (shownFrom < shownTo) {
        const link = target + heading;
        this.out.push(Decoration.mark({ class: "cm-wikilink", attributes: { "data-wikilink": link } }).range(shownFrom, shownTo));
      }
      this.hideUnlessActive(at, shownFrom);
      this.hideUnlessActive(shownTo, end);
    }
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new Builder(view);
  builder.frontmatter();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({ from, to, enter: (node) => builder.node(node) });
    builder.wikilinks(from, to);
  }
  return Decoration.set(builder.out, true);
}

/** Draws Markdown as it will read, showing the syntax only on the lines being edited. The text itself never changes. */
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate): void {
      const treeMoved = syntaxTree(update.startState) !== syntaxTree(update.state);
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged || treeMoved) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
