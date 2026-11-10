type Axis = "x" | "y";

const EDGE = 12;
const INSET = 2;
const LEAST = 32;
const IDLE_MS = 800;
const INPUT_MS = 250;
const YIELDS_TO = ".sidebar-resize, .rail-resize, .rail-section-resize, .trail-x";
const BARLESS = ".graph-groups";
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

const roomOn = (el: Element, axis: Axis) => (axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);

function scrollsOn(el: Element, axis: Axis): boolean {
  if (roomOn(el, axis) <= 1 || el instanceof HTMLInputElement || el.matches(BARLESS)) return false;
  const style = getComputedStyle(el);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  return overflow === "auto" || overflow === "scroll";
}

function nearest(from: Element | null, axis: Axis): Element | null {
  for (let el = from; el && el !== document.body; el = el.parentElement) if (scrollsOn(el, axis)) return el;
  return null;
}

/** The part of a scroller on screen: a wide table can run past the bottom of the note holding it. */
function visibleBox(el: Element): DOMRect {
  const box = el.getBoundingClientRect();
  let { left, top, right, bottom } = box;
  for (const axis of ["x", "y"] as const) {
    const outer = nearest(el.parentElement, axis)?.getBoundingClientRect();
    if (!outer) continue;
    left = Math.max(left, outer.left);
    top = Math.max(top, outer.top);
    right = Math.min(right, outer.right);
    bottom = Math.min(bottom, outer.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/** The one bar for a direction: it belongs to whichever scroller was last used or approached. */
class Bar {
  readonly root = document.createElement("div");
  owner: Element | null = null;
  held = false;
  private near = false;
  private timer = 0;

  constructor(private readonly axis: Axis) {
    this.root.className = `scrollbar is-${axis}`;
    this.root.setAttribute("aria-hidden", "true");
    this.root.addEventListener("pointerdown", (e) => this.drag(e));
    document.body.append(this.root);
  }

  private get vertical(): boolean {
    return this.axis === "y";
  }

  private span(box: DOMRect): number {
    return (this.vertical ? box.height : box.width) - INSET * 2;
  }

  private length(box: DOMRect, el: Element): number {
    const view = this.vertical ? el.clientHeight : el.clientWidth;
    return Math.max(LEAST, (this.span(box) * view) / (view + roomOn(el, this.axis)));
  }

  /** Scrolled by the wheel or keys: appears, and leaves once nothing has moved for a moment. */
  show(owner: Element): void {
    if (owner !== this.owner) this.setNear(false);
    this.owner = owner;
    this.root.classList.add("is-on");
    this.place();
    this.restTimer();
  }

  /** Follows the scroller without showing, so scrolling the app does on its own stays silent. */
  place(): void {
    const el = this.owner;
    if (!el?.isConnected) {
      this.hide();
      return;
    }
    const box = visibleBox(el);
    const span = this.span(box);
    const room = roomOn(el, this.axis);
    if (span <= LEAST || room <= 0) {
      this.hide();
      return;
    }
    const length = this.length(box, el);
    const at = this.vertical ? el.scrollTop : el.scrollLeft;
    const along = INSET + ((span - length) * Math.min(at, room)) / room;
    this.root.style.transform = this.vertical
      ? `translate(${box.right - EDGE}px, ${box.top + along}px)`
      : `translate(${box.left + along}px, ${box.bottom - EDGE}px)`;
    this.root.style[this.vertical ? "height" : "width"] = `${length}px`;
  }

  /** The pointer came to this scroller's edge, or left it. */
  approach(owner: Element | null, x: number, y: number): void {
    const box = owner && visibleBox(owner);
    const close = !!box && (this.vertical ? box.right - x : box.bottom - y) <= EDGE;
    if (close && owner) {
      this.owner = owner;
      this.root.classList.add("is-on");
      this.place();
      window.clearTimeout(this.timer);
    }
    if (close !== this.near) {
      this.setNear(close);
      if (!close) this.restTimer();
    }
  }

  /** Whatever sits beneath takes the pointer instead. */
  giveWay(): void {
    this.setNear(false);
    this.restTimer();
  }

  private setNear(near: boolean): void {
    this.near = near;
    this.root.classList.toggle("is-near", near);
  }

  private hide(): void {
    window.clearTimeout(this.timer);
    this.owner = null;
    this.setNear(false);
    this.root.classList.remove("is-on");
  }

  private restTimer(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.near && !this.held) this.root.classList.remove("is-on");
    }, IDLE_MS);
  }

  private drag(down: PointerEvent): void {
    const el = this.owner;
    if (!el) return;
    down.preventDefault();
    this.root.setPointerCapture(down.pointerId);
    this.held = true;
    this.root.classList.add("is-held");
    window.clearTimeout(this.timer);
    const box = visibleBox(el);
    const ratio = roomOn(el, this.axis) / Math.max(1, this.span(box) - this.length(box, el));
    const start = this.vertical ? down.clientY : down.clientX;
    const from = this.vertical ? el.scrollTop : el.scrollLeft;
    const move = (e: PointerEvent) => {
      const to = from + ((this.vertical ? e.clientY : e.clientX) - start) * ratio;
      if (this.vertical) el.scrollTop = to;
      else el.scrollLeft = to;
    };
    const end = () => {
      this.held = false;
      this.root.classList.remove("is-held");
      this.root.removeEventListener("pointermove", move);
      this.restTimer();
    };
    this.root.addEventListener("pointermove", move);
    this.root.addEventListener("pointerup", end, { once: true });
    this.root.addEventListener("pointercancel", end, { once: true });
  }
}

/** Draws the app's own scrollbars. Native ones are hidden in the stylesheet. */
export function installScrollbars(): void {
  const bars = [new Bar("x"), new Bar("y")] as const;
  const isBar = (t: EventTarget | null) => bars.some((bar) => bar.root === t);
  let lastInput = Number.NEGATIVE_INFINITY;
  let hovered: Element | null = null;
  let under: [Element | null, Element | null] = [null, null];
  const capture = { capture: true, passive: true };

  document.addEventListener(
    "wheel",
    () => {
      lastInput = performance.now();
    },
    capture,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.metaKey && !e.ctrlKey && SCROLL_KEYS.has(e.key)) lastInput = performance.now();
    },
    capture,
  );
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      const byHand = performance.now() - lastInput < INPUT_MS;
      for (const bar of bars) {
        if (bar.held || bar.owner === el) bar.place();
        if (byHand && !bar.held && scrollsOn(el, bar === bars[0] ? "x" : "y")) bar.show(el);
      }
    },
    capture,
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (bars.some((bar) => bar.held)) return;
      if (isBar(e.target)) {
        const beneath = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !isBar(el));
        if (beneath?.closest(YIELDS_TO)) for (const bar of bars) bar.giveWay();
        return;
      }
      const target = e.target as Element;
      if (target !== hovered) {
        hovered = target;
        under = target.closest(YIELDS_TO) ? [null, null] : [nearest(target, "x"), nearest(target, "y")];
      }
      for (const [i, bar] of bars.entries()) bar.approach(under[i], e.clientX, e.clientY);
    },
    capture,
  );
  document.documentElement.addEventListener("mouseleave", () => {
    hovered = null;
    under = [null, null];
    for (const bar of bars) if (!bar.held) bar.approach(null, 0, 0);
  });
}
