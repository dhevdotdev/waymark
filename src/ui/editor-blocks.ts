import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { renderDiagrams } from "../render/diagrams";
import { drawMath, loadMath } from "../render/math";

const PARSE_BUDGET_MS = 200;
const DIAGRAM_HEIGHT_GUESS = 260;
const DISPLAY_MATH = /^ {0,3}\$\$([^$]*?[^\\])\$\$[ \t]*$/gm;
const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[\s\S]*?(?:^ {0,3}\1|(?![\s\S]))/gm;
const CODE_SPAN = /(`+)[^\n]*?\1/g;
/** Run one line at a time: the lookbehind is slow over a whole note in WebKit without its JIT. */
export const INLINE_MATH = /(?<![\\\d$])\$(?!\$)([^\s\\$]|\S.*?[^\s\\])\$(?![\d$])/g;

interface Block {
  from: number;
  to: number;
  kind: "diagram" | "math" | "frontmatter";
  source: string;
}

class DiagramWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: DiagramWidget): boolean {
    return other.source === this.source;
  }
  get estimatedHeight(): number {
    return DIAGRAM_HEIGHT_GUESS;
  }
  toDOM(view: EditorView): HTMLElement {
    const block = document.createElement("div");
    block.className = "cm-preview-block";
    const figure = document.createElement("figure");
    figure.className = "diagram";
    figure.dataset.diagram = "mermaid";
    const code = document.createElement("pre");
    code.className = "diagram-source";
    code.textContent = this.source;
    figure.append(code);
    block.append(figure);
    void renderDiagrams(block).then(() => view.requestMeasure());
    return block;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.display ? "div" : "span");
    element.className = this.display ? "cm-preview-block cm-math-block" : "cm-math-inline";
    if (drawMath(element, this.tex, this.display)) return element;
    element.textContent = this.tex;
    void loadMath().then(() => {
      element.textContent = "";
      if (drawMath(element, this.tex, this.display)) view.requestMeasure();
      else element.textContent = this.tex;
    });
    return element;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** Whether the editor will draw math in `text`, so KaTeX can load before the editor's first paint. */
export function editorHasMath(text: string): boolean {
  if (!text.includes("$")) return false;
  const prose = text.replace(FENCED_CODE, "").replace(CODE_SPAN, "");
  if (new RegExp(DISPLAY_MATH.source, "m").test(prose)) return true;
  return prose.split("\n").some((line) => line.includes("$") && new RegExp(INLINE_MATH.source).test(line));
}

export async function prepareEditorMath(text: string): Promise<void> {
  if (editorHasMath(text)) await loadMath();
}

/** A quoted diagram has a prefix on every line, so it stays as text. */
function diagramIn(state: EditorState, node: SyntaxNode): Block | null {
  const info = node.getChild("CodeInfo");
  const text = node.getChild("CodeText");
  if (!info || !text || node.getChildren("CodeMark").length < 2) return null;
  if (state.sliceDoc(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() !== "mermaid") return null;
  for (let at = node.parent; at; at = at.parent) if (at.name === "Blockquote") return null;
  const opening = state.doc.lineAt(node.from);
  const indent = new RegExp(`^ {0,${node.from - opening.from}}`, "gm");
  return {
    from: opening.from,
    to: state.doc.lineAt(node.to).to,
    kind: "diagram",
    source: state.sliceDoc(text.from, text.to).replace(indent, ""),
  };
}

function displayMathIn(state: EditorState, start: number, code: [number, number][]): Block[] {
  const text = state.doc.toString();
  if (!text.includes("$$")) return [];
  return [...text.matchAll(DISPLAY_MATH)]
    .filter((match) => match.index >= start && !code.some(([from, to]) => match.index >= from && match.index < to))
    .map((match) => ({ from: match.index, to: match.index + match[0].length, kind: "math", source: match[1].trim() }));
}

/** Properties live in the inspector, so the text and the blank lines under it stay out of the way until the cursor goes there. */
function frontmatterBlock(state: EditorState, end: number): Block[] {
  if (!end) return [];
  const { doc } = state;
  let last = doc.lineAt(end - 1);
  while (last.number < doc.lines - 1 && doc.line(last.number + 1).text.trim() === "") last = doc.line(last.number + 1);
  return [{ from: 0, to: last.to, kind: "frontmatter", source: "" }];
}

function findBlocks(state: EditorState, start: number): Block[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const blocks: Block[] = [];
  const code: [number, number][] = [];
  tree.iterate({
    enter(ref) {
      if (ref.name === "Paragraph") return false;
      if (ref.name !== "FencedCode" && ref.name !== "CodeBlock") return true;
      code.push([ref.from, ref.to]);
      const diagram = ref.name === "FencedCode" && ref.from >= start ? diagramIn(state, ref.node) : null;
      if (diagram) blocks.push(diagram);
      return false;
    },
  });
  blocks.push(...frontmatterBlock(state, start), ...displayMathIn(state, start, code));
  return blocks.sort((a, b) => a.from - b.from);
}

interface FieldValue {
  blocks: Block[];
  focused: boolean;
  decorations: DecorationSet;
}

const focusChanged = StateEffect.define<boolean>();

function decorate(state: EditorState, blocks: Block[], focused: boolean): DecorationSet {
  const editing = (block: Block) => focused && state.selection.ranges.some((r) => r.from <= block.to && r.to >= block.from);
  return Decoration.set(
    blocks
      .filter((block) => !editing(block))
      .map((block) => {
        if (block.kind === "frontmatter") return Decoration.replace({ block: true }).range(block.from, block.to);
        const widget = block.kind === "diagram" ? new DiagramWidget(block.source) : new MathWidget(block.source, true);
        return Decoration.replace({ widget, block: true }).range(block.from, block.to);
      }),
  );
}

export interface PreviewBlocks {
  extension: Extension;
  /** Where a cursor can start near `pos` without opening a block. */
  outsideBlocks(state: EditorState, pos: number): number;
}

/** Draws diagrams and display math in place. Moving the cursor into one shows its source. */
export function previewBlocks(frontmatterEnd: (state: EditorState) => number): PreviewBlocks {
  const field = StateField.define<FieldValue>({
    create(state) {
      const blocks = findBlocks(state, frontmatterEnd(state));
      return { blocks, focused: false, decorations: decorate(state, blocks, false) };
    },
    update(value, tr) {
      let focused = value.focused;
      for (const effect of tr.effects) if (effect.is(focusChanged)) focused = effect.value;
      if (!tr.docChanged && !tr.selection && focused === value.focused) return value;
      const blocks = tr.docChanged ? findBlocks(tr.state, frontmatterEnd(tr.state)) : value.blocks;
      return { blocks, focused, decorations: decorate(tr.state, blocks, focused) };
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.decorations),
  });
  return {
    extension: [field, EditorView.focusChangeEffect.of((_state, focusing) => focusChanged.of(focusing))],
    outsideBlocks(state, pos) {
      const block = state.field(field).blocks.find((b) => pos >= b.from && pos <= b.to);
      return block ? Math.min(block.to + 1, state.doc.length) : pos;
    },
  };
}
