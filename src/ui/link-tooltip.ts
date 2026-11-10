import { cutMiddle, type Destination, destinationOf } from "../render/link-destination";

const LINK = ".doc a[href], .cm-link[data-href]";
const OPENS_OUTSIDE = /^(?:https?:|mailto:)/i;
const MOST_LINES = 3;
const GAP = 6;
const MARGIN = 8;

/** Reads the address the link really opens, each time, so nothing else in a note can speak for it. */
function realHref(link: HTMLElement): string | null {
  const written = link.dataset.href ?? link.getAttribute("href") ?? "";
  if (!OPENS_OUTSIDE.test(written)) return null;
  return link instanceof HTMLAnchorElement ? link.href : written;
}

/** The web or mail link at `el`, if there is one. */
export function outsideLink(el: Element): HTMLElement | null {
  const link = el.closest<HTMLElement>(LINK);
  const href = link && realHref(link);
  return href && destinationOf(href) ? link : null;
}

export function linkDestination(link: HTMLElement): Destination | null {
  const href = realHref(link);
  return href ? destinationOf(href) : null;
}

/** Writes the destination into a tooltip already on the page, cutting the path if it would pass three lines. */
export function fillDestination(tip: HTMLElement, { site, rest }: Destination): void {
  tip.classList.add("is-destination");
  tip.style.left = "0";
  tip.style.top = "0";
  const name = document.createElement("span");
  name.textContent = site;
  const path = document.createElement("span");
  path.className = "tooltip-path";
  path.textContent = rest;
  tip.replaceChildren(name, path);
  const style = getComputedStyle(tip);
  const tallest =
    MOST_LINES * Number.parseFloat(style.lineHeight) +
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom) +
    1;
  if (tip.offsetHeight <= tallest) return;
  const chars = Array.from(rest);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const keep = Math.ceil((low + high) / 2);
    path.textContent = cutMiddle(chars, keep);
    if (tip.offsetHeight <= tallest) low = keep;
    else high = keep - 1;
  }
  path.textContent = cutMiddle(chars, low);
}

/** Puts the tooltip under the line of the link being pointed at, left-aligned with it, or above when there is no room. */
export function placeUnderLink(tip: HTMLElement, link: HTMLElement, pointerY: number | null): void {
  const lines = [...link.getClientRects()];
  const line = lines.find((r) => pointerY !== null && pointerY >= r.top && pointerY <= r.bottom) ?? lines[0];
  if (!line) return;
  const { offsetWidth: width, offsetHeight: height } = tip;
  const room = line.bottom + GAP + height + MARGIN <= window.innerHeight;
  tip.style.left = `${Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, line.left))}px`;
  tip.style.top = `${Math.max(MARGIN, room ? line.bottom + GAP : line.top - GAP - height)}px`;
}
