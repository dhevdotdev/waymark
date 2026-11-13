import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, type StateEffect, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { foldable, noteSections, type Section, sectionAt } from "../vault/sections";
import { foldTail } from "./reading-folds";

export type FoldAction = "toggle" | "all" | "none";

export interface FoldOptions {
  /** Keys of the headings folded in this note, shared with the reading view. */
  folded: string[];
  onFolds: (keys: string[]) => void;
}

interface Span {
  from: number;
  to: number;
}

const known = new WeakMap<Text, Section[]>();

/** The same sections the reading view folds, read from the editor's text once per version of it. */
function sectionsOf(doc: Text): Section[] {
  let sections = known.get(doc);
  if (!sections) {
    sections = foldable(noteSections(doc.toString()));
    known.set(doc, sections);
  }
  return sections;
}

/** From the end of the heading to the end of its last line of text, so the blank lines before the next heading stay. */
const spanOf = (doc: Text, section: Section): Span => ({
  from: doc.line(section.headEnd + 1).to,
  to: doc.line(section.last + 1).to,
});

function foldedSpans(state: EditorState): Span[] {
  const spans: Span[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    spans.push({ from, to });
  });
  return spans;
}

function foldedKeys(state: EditorState): string[] {
  const starts = new Set(foldedSpans(state).map((span) => span.from));
  return sectionsOf(state.doc)
    .filter((section) => starts.has(spanOf(state.doc, section).from))
    .map((section) => section.key);
}

/** Where the cursor goes when its line is folded away: the end of the outermost heading that hid it. */
function outside(state: EditorState, spans: Span[]): EditorSelection | undefined {
  const head = state.selection.main.head;
  const cover = spans.filter((span) => span.from < head && head <= span.to).sort((a, b) => a.from - b.from)[0];
  return cover ? EditorSelection.single(cover.from) : undefined;
}

/** Keeps a heading where it is on screen while the section under it folds or unfolds. */
function holdHeading(view: EditorView, at: number, change: () => void): void {
  const scroller = view.dom.closest<HTMLElement>(".scroller");
  const before = view.coordsAtPos(at, 1)?.top;
  change();
  if (!scroller || before === undefined) return;
  view.requestMeasure({
    read: () => view.coordsAtPos(at, 1)?.top,
    write: (after) => {
      if (after !== undefined) scroller.scrollTop += after - before;
    },
  });
}

function foldSections(view: EditorView, sections: Section[], fold: boolean): void {
  const { state } = view;
  const folded = foldedSpans(state);
  const isFolded = (span: Span) => folded.some((f) => f.from === span.from && f.to === span.to);
  const effects: StateEffect<Span>[] = [];
  for (const section of sections) {
    const span = spanOf(state.doc, section);
    if (fold && !isFolded(span)) effects.push(foldEffect.of(span));
    if (!fold) for (const f of folded) if (f.from === span.from) effects.push(unfoldEffect.of(f));
  }
  if (!effects.length) return;
  const selection = fold ? outside(state, [...folded, ...effects.map((e) => e.value)]) : undefined;
  view.dispatch({ effects, selection, scrollIntoView: selection !== undefined });
}

/** Folds or unfolds the section around the cursor, every section, or none. */
export function foldAction(view: EditorView, action: FoldAction): void {
  const sections = sectionsOf(view.state.doc);
  if (action !== "toggle") {
    foldSections(view, sections, action === "all");
    return;
  }
  const section = sectionAt(sections, view.state.doc.lineAt(view.state.selection.main.head).number - 1);
  if (!section) return;
  const span = spanOf(view.state.doc, section);
  foldSections(view, [section], !foldedSpans(view.state).some((f) => f.from === span.from));
}

/** The heading line whose margin chevron sits under the pointer, or null. */
function chevronAt(event: MouseEvent): HTMLElement | null {
  const head = (event.target as Element).closest?.<HTMLElement>(".cm-fold-head");
  if (!head || head.closest(".cm-line")?.querySelector(".cm-hang.is-shown")) return null;
  const chevron = getComputedStyle(head, "::before");
  const start = head.getClientRects()[0];
  if (!start) return null;
  const width = Number.parseFloat(chevron.width);
  const gap = Number.parseFloat(chevron.marginInlineEnd);
  const inside = event.clientX >= start.left - width - gap && event.clientX < start.left - gap;
  return inside && event.clientY >= start.top && event.clientY < start.bottom ? head : null;
}

let hot: HTMLElement | null = null;

function heat(head: HTMLElement | null): void {
  if (head === hot) return;
  hot?.classList.remove("is-hot");
  head?.classList.add("is-hot");
  hot = head;
}

function flipAt(view: EditorView, head: HTMLElement): void {
  const line = view.state.doc.lineAt(view.posAtDOM(head));
  const section = sectionsOf(view.state.doc).find((s) => s.line === line.number - 1);
  if (!section) return;
  const span = spanOf(view.state.doc, section);
  const folded = foldedSpans(view.state).some((f) => f.from === span.from);
  holdHeading(view, line.from, () => foldSections(view, [section], !folded));
}

/**
 * The chevron is the heading's own ::before, drawn in the margin. A widget there would sit where the caret
 * rests at the heading's start, and CodeMirror's buffer beside it would add height to the line.
 */
const chevronEvents = EditorView.domEventHandlers({
  mousedown(event, view) {
    const head = event.button === 0 ? chevronAt(event) : null;
    if (!head) return false;
    event.preventDefault();
    flipAt(view, head);
    return true;
  },
  mousemove(event) {
    heat(chevronAt(event));
  },
  mouseleave() {
    heat(null);
  },
});

function toggles(state: EditorState): DecorationSet {
  const starts = new Set(foldedSpans(state).map((span) => span.from));
  const marks = [];
  for (const section of sectionsOf(state.doc)) {
    const folded = starts.has(spanOf(state.doc, section).from);
    const line = state.doc.line(section.line + 1);
    if (line.from === line.to) continue;
    marks.push(Decoration.mark({ class: folded ? "cm-fold-head is-folded" : "cm-fold-head" }).range(line.from, line.to));
    if (folded) marks.push(Decoration.line({ class: "cm-folded" }).range(line.from));
  }
  return Decoration.set(marks, true);
}

/** An outer decoration, so the heading's mark stays whole around every other mark on its line and its chevron leads. */
const foldToggles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = toggles(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || foldedRanges(update.startState) !== foldedRanges(update.state))
        this.decorations = toggles(update.state);
    }
  },
  { provide: (plugin) => EditorView.outerDecorations.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none) },
);

/** An edit that reaches into a folded section unfolds it in the same step, so nothing is typed or deleted out of sight. */
const unfoldTouched = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged) return null;
  const effects: StateEffect<Span>[] = [];
  for (const span of foldedSpans(tr.startState)) {
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= span.to && toA > span.from) touched = true;
    });
    if (touched) effects.push(unfoldEffect.of({ from: tr.changes.mapPos(span.from, 1), to: tr.changes.mapPos(span.to, -1) }));
  }
  return effects.length ? { effects } : null;
});

function placeholderDOM(_view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const tail = foldTail();
  const more = tail.firstElementChild!;
  more.addEventListener("mousedown", (e) => e.preventDefault());
  more.addEventListener("click", onclick);
  return tail;
}

export function editorFolds(options: FoldOptions): Extension {
  let saved = options.folded.join("\n");
  return [
    codeFolding({ placeholderDOM }),
    foldToggles,
    chevronEvents,
    unfoldTouched,
    EditorView.updateListener.of((update) => {
      if (foldedRanges(update.startState) === foldedRanges(update.state)) return;
      if (!foldedRanges(update.state).size && !saved) return;
      const keys = foldedKeys(update.state);
      if (keys.join("\n") === saved) return;
      saved = keys.join("\n");
      options.onFolds(keys);
    }),
  ];
}

/** Folds what the note had folded, as the editor opens. */
export function foldSaved(view: EditorView, keys: string[]): void {
  const wanted = new Set(keys);
  foldSections(
    view,
    sectionsOf(view.state.doc).filter((section) => wanted.has(section.key)),
    true,
  );
}
