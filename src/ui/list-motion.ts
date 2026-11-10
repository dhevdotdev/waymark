const LIST_MOTION = "list-motion";
const NOTICEABLE_PX = 0.5;

export interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rootToken = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const tokenPx = (name: string): number => Number.parseFloat(rootToken(name)) || 0;

export function timing(duration: string, easing: string): KeyframeAnimationOptions {
  return { duration: tokenPx(duration), easing: rootToken(easing), id: LIST_MOTION };
}

/** Where each element is on screen right now, partway through any motion, measured within `frame` so scrolling does not count. */
export function placesOf<K>(rows: ReadonlyMap<K, HTMLElement>, frame: HTMLElement): Map<K, Place> {
  const origin = frame.getBoundingClientRect();
  const places = new Map<K, Place>();
  for (const [key, el] of rows) {
    const { left, top, width, height } = el.getBoundingClientRect();
    places.set(key, { left: left - origin.left + frame.scrollLeft, top: top - origin.top + frame.scrollTop, width, height });
  }
  return places;
}

/** Slides each element from where it was to where it now rests. An element already moving carries on from where it had got to. */
export function glide<K>(
  rows: ReadonlyMap<K, HTMLElement>,
  was: ReadonlyMap<K, Place>,
  frame: HTMLElement,
  options: KeyframeAnimationOptions,
): Animation[] {
  for (const [key, el] of rows) {
    if (!was.has(key)) continue;
    for (const animation of el.getAnimations()) if (animation.id === LIST_MOTION) animation.cancel();
  }
  const now = placesOf(rows, frame);
  const started: Animation[] = [];
  for (const [key, el] of rows) {
    const from = was.get(key);
    const to = now.get(key);
    if (!from || !to) continue;
    const x = from.left - to.left;
    const y = from.top - to.top;
    if (Math.abs(x) < NOTICEABLE_PX && Math.abs(y) < NOTICEABLE_PX) continue;
    started.push(el.animate({ translate: [`${x}px ${y}px`, "0 0"] }, options));
  }
  return started;
}

export function arrive(el: HTMLElement, options: KeyframeAnimationOptions, rise = 0): void {
  el.animate({ opacity: [0, 1], translate: [`0 ${rise}px`, "0 0"] }, options);
}

/** Fades out an element that is only a picture of something gone, and removes it however the fade ends. */
export function fadeAway(el: HTMLElement, options: KeyframeAnimationOptions): void {
  const fade = el.animate({ opacity: [1, 0] }, options);
  fade.onfinish = () => el.remove();
  fade.oncancel = () => el.remove();
}

export const isSettling = (root: HTMLElement): boolean =>
  root.getAnimations({ subtree: true }).some((animation) => animation.id === LIST_MOTION);

/** Lets rows travel past an edge that normally clips them, for as long as they are travelling. */
export function holdClassWhile(el: HTMLElement, className: string, animations: Animation[]): void {
  if (!animations.length) return;
  el.classList.add(className);
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    if (!isSettling(el)) el.classList.remove(className);
  });
}

/** A brief tint on something that just landed. It is a colour change, so it stays under Reduce Motion, and keyboard actions hold it without a fade. */
export function flashLanded(el: HTMLElement): void {
  el.classList.remove("is-landed");
  void el.offsetWidth;
  el.classList.add("is-landed");
  el.addEventListener("animationend", () => el.classList.remove("is-landed"), { once: true });
}
