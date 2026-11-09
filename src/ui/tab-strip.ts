import type { View } from "../vault/trail";
import type { Workspace } from "../vault/workspace";
import { icons } from "./icons";
import { reducedMotion } from "./media";

const MAX_NATURAL_TAB = 320;
const MIN_TAB = 72;
/** A tab's padding and close control, around its title. */
const TAB_CHROME = 40;
const TAB_GAP = 2;
/** The strip's own padding plus the new-tab button and its margin. */
const STRIP_CHROME = 42;

const watchedStrips = new WeakSet<HTMLElement>();

/** Draws the tab strip. `entering` names a tab that should animate in. */
export function renderTabStrip(
  strip: HTMLElement,
  workspace: Workspace,
  labelOf: (view: View) => string,
  entering?: number,
): void {
  const frag = document.createDocumentFragment();
  workspace.tabs.forEach((tab, i) => {
    const active = i === workspace.activeIndex;
    const view = tab.trail.current.view;
    const title = labelOf(view);
    const el = document.createElement("div");
    el.className = `tab${active ? " is-active" : ""}${tab.id === entering && !reducedMotion() ? " is-entering" : ""}`;
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.dataset.tab = String(i);
    el.dataset.tip = title;
    el.classList.toggle("is-graph-tab", view.kind === "graph");
    el.innerHTML = `<button class="icon-btn tab-close" data-tab-close aria-label="Close tab">${icons.close}</button><span class="tab-title"></span>`;
    el.querySelector(".tab-title")!.textContent = title;
    if (tab.id === entering) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-entering")));
    frag.append(el);
  });
  const plus = document.createElement("button");
  plus.className = "icon-btn tab-new";
  plus.dataset.act = "new-tab";
  plus.dataset.tip = "New tab";
  plus.dataset.key = "⌘T";
  plus.setAttribute("aria-label", "New tab");
  plus.innerHTML = icons.plus;
  frag.append(plus);
  strip.replaceChildren(frag);
  requestAnimationFrame(() => fitTabs(strip));
  if (!watchedStrips.has(strip)) {
    watchedStrips.add(strip);
    new ResizeObserver(() => fitTabs(strip)).observe(strip);
  }
}

/**
 * The widest any tab may be so that all of them fit, or null when they already do.
 * Only the tabs wider than the limit give up room, so a short title keeps its width.
 */
export function tabWidthLimit(widths: number[], room: number): number | null {
  if (widths.reduce((sum, width) => sum + width, 0) <= room) return null;
  const ascending = [...widths].sort((a, b) => a - b);
  let remaining = room;
  for (const [i, width] of ascending.entries()) {
    const share = remaining / (ascending.length - i);
    if (width > share) return Math.max(MIN_TAB, share);
    remaining -= width;
  }
  return null;
}

/** A title stretches to fill its tab, so its own box cannot say how long the text is. */
function textWidth(title: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(title);
  return Math.ceil(range.getBoundingClientRect().width);
}

function fitTabs(strip: HTMLElement): void {
  const titles = [...strip.querySelectorAll<HTMLElement>(".tab-title")];
  const natural = titles.map((title) => Math.min(textWidth(title) + TAB_CHROME, MAX_NATURAL_TAB));
  const limit = tabWidthLimit(natural, strip.clientWidth - STRIP_CHROME - TAB_GAP * titles.length);
  if (limit === null) strip.style.removeProperty("--tab-limit");
  else strip.style.setProperty("--tab-limit", `${limit}px`);
  for (const tab of strip.querySelectorAll<HTMLElement>(".tab")) {
    const title = tab.querySelector<HTMLElement>(".tab-title")!;
    tab.classList.toggle("is-clipped", title.scrollWidth > title.clientWidth + 1);
  }
}
