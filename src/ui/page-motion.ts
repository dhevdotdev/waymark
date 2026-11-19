import { isPointerAction } from "./input-origin";
import { reducedMotion } from "./media";
import type { Step } from "./swipe-cue";

/** How a newly mounted note arrives. Only a pointer action gets one; everything else shows the page at once. */
export type Entrance = { kind: "fade" } | { kind: "slide"; step: Step } | { kind: "carry"; source: HTMLElement; at: number };

/** A carry measured and ready to fly once the new title is in place. */
type Plan = { kind: "fade" } | { kind: "slide"; step: Step } | { kind: "carry"; from: Measured };

interface Measured {
  text: string;
  rect: DOMRect;
  style: CSSStyleDeclaration;
}

const TRAVEL_PX = 28;
/** The share of the flight by which the two copies have swapped, as in a crossfade. */
const SWAP = 0.45;
const BODY_DELAY_MS = 60;
/** A carry that would start this long after the click no longer reads as its result, so a slow note gets the plain entrance. */
const STALE_MS = 250;
/** Views that cover the scroller, whose last note is not what is on screen. */
const COVERED = ".is-graph, .is-blank, .is-base";
const COPIED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontStretch",
  "fontFeatureSettings",
  "fontVariationSettings",
  "fontVariantNumeric",
  "fontOpticalSizing",
  "fontSynthesis",
  "letterSpacing",
  "lineHeight",
  "textWrap",
  "textOverflow",
] as const;

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const tokenMs = (name: string): number => Number.parseFloat(token(name)) || 0;

/** The entrance for a note opened by `via`, decided as the action happens. `source` is the clicked text to carry into the title. */
export function entranceFor(via: "link" | "jump" | undefined, source?: HTMLElement): Entrance | undefined {
  if (!isPointerAction()) return undefined;
  if (source) return { kind: "carry", source, at: performance.now() };
  return via === "link" ? { kind: "fade" } : undefined;
}

export const slideFor = (step: Step): Entrance | undefined => (isPointerAction() ? { kind: "slide", step } : undefined);

/** Whether all of `rect` can be seen, inside the window and every ancestor that clips it. */
function inSight(el: Element, rect: DOMRect): boolean {
  if (rect.width < 1 || rect.height < 1) return false;
  const fits = (box: { top: number; bottom: number; left: number; right: number }) =>
    rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1;
  if (!fits({ top: 0, left: 0, bottom: innerHeight, right: innerWidth })) return false;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    if (!fits(a.getBoundingClientRect())) return false;
  }
  return true;
}

function measure(entrance: Extract<Entrance, { kind: "carry" }>): Measured | null {
  const text = entrance.source.querySelector<HTMLElement>(".nav-text") ?? entrance.source;
  if (reducedMotion() || !text.isConnected || performance.now() - entrance.at > STALE_MS) return null;
  /* A link that wraps carries its first line, which is where its text starts. */
  const rect = text.getClientRects()[0];
  if (!rect || !inSight(text, rect)) return null;
  return { text: text.textContent ?? "", rect, style: getComputedStyle(text) };
}

/** A fixed copy of some text, laid out as `style` lays it out in `rect`, above everything and taking no clicks. */
function copyOf(text: string, rect: DOMRect, style: CSSStyleDeclaration, wraps: boolean): HTMLElement {
  const copy = document.createElement("div");
  copy.className = "page-carry";
  copy.setAttribute("aria-hidden", "true");
  copy.textContent = text;
  for (const key of COPIED) copy.style[key] = style[key];
  Object.assign(copy.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    color: style.color,
    whiteSpace: wraps ? "normal" : "nowrap",
  });
  document.body.append(copy);
  return copy;
}

/** The page transitions of the reading column: the old page leaving as a ghost, and the new one arriving. */
export class PageMotion {
  private plan: Plan | undefined;
  private readonly flying = new Set<HTMLElement>();

  constructor(private readonly scroller: HTMLElement) {}

  /** Runs before the new page replaces the old one, while the old one and what was clicked are still on screen. Returns whether the new page should take the plain fade. */
  leave(entrance: Entrance | undefined): boolean {
    for (const copy of this.flying) copy.remove();
    this.flying.clear();
    for (const ghost of this.scroller.parentElement?.querySelectorAll(":scope > .page-ghost") ?? []) ghost.remove();
    this.plan = undefined;
    /* A graph diving into its note fading off the page is that note's entrance already. */
    if (this.scroller.parentElement?.querySelector(":scope > .graph-view.is-leaving")) return false;
    if (!entrance || entrance.kind === "fade") return entrance !== undefined;
    if (entrance.kind === "slide") {
      this.plan = entrance;
      this.ghost(reducedMotion() ? 0 : -entrance.step * TRAVEL_PX);
      return false;
    }
    const from = measure(entrance);
    if (!from) return true;
    this.plan = { kind: "carry", from };
    this.ghost(0);
    return false;
  }

  /** Runs once the new page is mounted and scrolled to where it opens. */
  enter(doc: HTMLElement): void {
    const plan = this.plan;
    this.plan = undefined;
    if (plan?.kind === "slide") this.slideIn(doc, plan.step);
    else if (plan?.kind === "carry" && !this.carry(doc, plan.from)) doc.classList.add("doc-enter");
  }

  /** Moves the page on screen out of the scroller into a copy of its frame, where it fades without taking space or clicks. */
  private ghost(dx: number): void {
    const old = this.scroller.querySelector<HTMLElement>(":scope > .doc");
    if (!old || this.scroller.closest(COVERED)) return;
    const style = getComputedStyle(old);
    const from = { opacity: style.opacity, translate: style.translate === "none" ? "0 0" : style.translate };
    for (const running of old.getAnimations({ subtree: true })) running.cancel();
    old.classList.remove("doc-enter");
    const top = this.scroller.scrollTop;
    const layer = document.createElement("div");
    layer.className = "page-ghost";
    layer.inert = true;
    layer.setAttribute("aria-hidden", "true");
    layer.append(old);
    this.scroller.after(layer);
    layer.scrollTop = top;
    const fade = layer.animate([from, { opacity: 0, translate: `${dx}px 0` }], {
      duration: tokenMs("--t-exit"),
      easing: token("--ease-out"),
      fill: "forwards",
    });
    fade.onfinish = () => layer.remove();
    fade.oncancel = () => layer.remove();
  }

  private slideIn(doc: HTMLElement, step: Step): void {
    const still = reducedMotion();
    const dx = still ? 0 : step * TRAVEL_PX;
    doc.animate(
      { opacity: [0, 1], translate: [`${dx}px 0`, "0 0"] },
      { duration: tokenMs(still ? "--t-exit" : "--t-slide"), easing: token("--ease-out") },
    );
  }

  /** Flies a copy of the clicked text into the title while the title's own copy grows out of it, then the body rises after it. */
  private carry(doc: HTMLElement, from: Measured): boolean {
    const title = doc.querySelector<HTMLElement>(".doc-title");
    if (!title) return false;
    const to = title.getBoundingClientRect();
    if (!inSight(title, to)) return false;
    const toStyle = getComputedStyle(title);
    const scale = Number.parseFloat(from.style.fontSize) / Number.parseFloat(toStyle.fontSize);
    const line = Number.parseFloat(toStyle.lineHeight) || to.height;
    const fromMid = from.rect.top + from.rect.height / 2;
    const toMid = to.top + line / 2;
    const timing: KeyframeAnimationOptions = { duration: tokenMs("--t-modal"), easing: token("--ease-in-out"), fill: "both" };

    const arriving = copyOf(title.textContent ?? "", to, toStyle, true);
    const leaving = copyOf(from.text, from.rect, from.style, false);
    const shrunk = `translate(${from.rect.left - to.left}px, ${fromMid - to.top - (line * scale) / 2}px) scale(${scale})`;
    const grown = `translate(${to.left - from.rect.left}px, ${toMid - from.rect.top - from.rect.height / 2 / scale}px) scale(${1 / scale})`;
    const flights = [
      arriving.animate(
        [
          { transform: shrunk, opacity: 0, color: from.style.color },
          { opacity: 1, offset: SWAP },
          { transform: "none", opacity: 1, color: toStyle.color },
        ],
        timing,
      ),
      leaving.animate(
        [
          { transform: "none", opacity: 1 },
          { opacity: 0, offset: SWAP },
          { transform: grown, opacity: 0 },
        ],
        timing,
      ),
    ];
    for (const [i, copy] of [arriving, leaving].entries()) {
      this.flying.add(copy);
      const done = () => {
        copy.remove();
        this.flying.delete(copy);
      };
      flights[i].onfinish = done;
      flights[i].oncancel = done;
    }
    title.animate({ opacity: [0, 0] }, { duration: tokenMs("--t-modal") });
    this.riseBody(doc);
    return true;
  }

  /** Only the blocks on screen rise; the rest are already in place when they are scrolled to. */
  private riseBody(doc: HTMLElement): void {
    const { top, bottom } = this.scroller.getBoundingClientRect();
    const rise = { opacity: [0, 1], translate: [`0 ${token("--rise") || "0px"}`, "0 0"] };
    const timing = {
      duration: tokenMs("--t-menu"),
      delay: BODY_DELAY_MS,
      easing: token("--ease-out"),
      fill: "backwards" as const,
    };
    for (const block of doc.querySelectorAll<HTMLElement>(":scope > :not(.doc-head)")) {
      const box = block.getBoundingClientRect();
      if (box.top > bottom) break;
      if (box.bottom > top) block.animate(rise, timing);
    }
  }
}
