import type { Extension } from "@codemirror/state";
import { EditorView, layer, type Rect, RectangleMarker } from "@codemirror/view";

const SHORTEST_BLANK_CARET = 16;

let measurer: CanvasRenderingContext2D | null = null;

/** Rounded the way WebKit rounds a text box, so a caret on plain text lands exactly on that text's box. */
function fontBox(element: Element): { ascent: number; descent: number } {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  const { fontStyle, fontWeight, fontSize, fontFamily } = getComputedStyle(element);
  measurer.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
  const metrics = measurer.measureText("x");
  return { ascent: Math.round(metrics.fontBoundingBoxAscent), descent: Math.round(metrics.fontBoundingBoxDescent) };
}

/** A position only has two places to be at a soft wrap. Anywhere else it belongs with the text that follows it. */
function sideOf(view: EditorView, head: number, assoc: number): -1 | 1 {
  const before = view.coordsAtPos(head, -1);
  const after = view.coordsAtPos(head, 1);
  const sameRow = !before || !after || (before.top < after.bottom && after.top < before.bottom);
  return sameRow || assoc >= 0 ? 1 : -1;
}

interface Place {
  at: Rect | null;
  text: Text | null;
  holder: Element | null;
}

function placeAt(view: EditorView, pos: number, side: -1 | 1): Place {
  const at = view.coordsAtPos(pos, side);
  for (const tried of [side, -side as -1 | 1]) {
    const { node } = view.domAtPos(pos, tried);
    if (node.nodeType === Node.TEXT_NODE) return { at, text: node as Text, holder: node.parentElement };
  }
  return { at, text: null, holder: view.domAtPos(pos, side).node as Element };
}

/** A heading with no words yet ends inside its hanging marks, and the caret waits where the words will start. */
function textOrigin(hang: Element): number {
  return hang.getBoundingClientRect().right + Number.parseFloat(getComputedStyle(hang).marginInlineEnd);
}

function caretMarker(view: EditorView): RectangleMarker | null {
  const { main } = view.state.selection;
  if (!main.empty || !view.hasFocus || view.state.readOnly) return null;
  const place = placeAt(view, main.head, sideOf(view, main.head, main.assoc));
  const line = place.holder?.closest(".cm-line");
  if (!place.at || !line) return null;

  /* Marks and their text round to different baselines, so the caret always sits on the text's. */
  const hang = place.holder?.closest(".cm-hang");
  const hangEnd = hang ? view.posAtDOM(hang) + (hang.textContent?.length ?? 0) : -1;
  const following = hang ? placeAt(view, hangEnd, 1) : place;
  const level = following.text && !following.holder?.closest(".cm-hang") ? following : place;
  const box = level.at ?? place.at;

  const run = fontBox(line);
  let height = run.ascent + run.descent;
  let top: number;
  if (line.classList.contains("cm-blank")) {
    const row = line.getBoundingClientRect();
    height = Math.min(height, Math.max(SHORTEST_BLANK_CARET, row.height));
    top = row.top + (row.height - height) / 2;
  } else if (level.text && level.holder) {
    top = box.top + fontBox(level.holder).ascent - run.ascent;
  } else {
    top = (box.top + box.bottom - height) / 2;
  }

  const x = hang && main.head === hangEnd ? textOrigin(hang) : place.at.left;
  const pixel = window.devicePixelRatio || 1;
  const width = pixel >= 2 ? 1.5 : 2;
  const snap = (value: number) => Math.round(value * pixel) / pixel;
  const base = view.scrollDOM.getBoundingClientRect();
  return new RectangleMarker(
    "cm-caret",
    snap(x - width / 2) - base.left + view.scrollDOM.scrollLeft,
    snap(top) - base.top + view.scrollDOM.scrollTop,
    width,
    snap(height),
  );
}

/**
 * Draws the caret for the note's text. WebKit's own takes its height from
 * whichever box it lands in, so it changes size between a marker and its
 * heading and between the rows of one wrapped paragraph. Selection stays
 * native, and so does the caret while an input method is composing.
 */
export function drawnCaret(): Extension {
  return [
    layer({
      above: true,
      class: "cm-caret-layer",
      markers(view) {
        const marker = caretMarker(view);
        return marker ? [marker] : [];
      },
      update(update, dom) {
        const moved = update.selectionSet || update.docChanged || update.focusChanged;
        if (moved) dom.classList.toggle("is-restarted");
        return moved || update.startState.readOnly !== update.state.readOnly;
      },
    }),
    EditorView.domEventHandlers({
      compositionstart(_event, view) {
        view.scrollDOM.classList.add("is-composing");
      },
      compositionend(_event, view) {
        view.scrollDOM.classList.remove("is-composing");
      },
    }),
  ];
}
