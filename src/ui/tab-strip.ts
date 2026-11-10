import type { View } from "../vault/trail";
import type { Workspace } from "../vault/workspace";
import { icons } from "./icons";
import { isPointerAction } from "./input-origin";
import { arrive, fadeAway, glide, isSettling, type Place, placesOf, timing } from "./list-motion";
import { reducedMotion } from "./media";

const MAX_NATURAL_TAB = 320;
const MIN_TAB = 72;
/** A tab's padding and close control, around its title. */
const TAB_CHROME = 40;
const TAB_GAP = 2;
/** The strip's own padding plus the new-tab button and its margin. */
const STRIP_CHROME = 42;

const watchedStrips = new WeakSet<HTMLElement>();

/** The new-tab button rides at the end of the strip, so it moves with the tabs. */
const NEW_TAB_KEY = -1;
const tabsIn = (strip: HTMLElement) =>
  new Map(
    [...strip.querySelectorAll<HTMLElement>(":scope > :is(.tab, .tab-new)")].map((el) => [
      el.dataset.tabId === undefined ? NEW_TAB_KEY : Number(el.dataset.tabId),
      el,
    ]),
  );

/** Which tabs there are, in what order, and which are pinned. A new title in the same place is not a change of shape. */
function shapeChanged(drawn: Map<number, HTMLElement>, workspace: Workspace): boolean {
  const before = [...drawn].map(([id, el]) => `${id}${el.classList.contains("is-pinned") ? "p" : ""}`);
  return before.join() !== [...workspace.tabs.map((tab) => `${tab.id}${tab.pinned ? "p" : ""}`), NEW_TAB_KEY].join();
}

/** Stands where a closed tab was while it fades. It is not a tab, so it takes no width and cannot be clicked. */
function ghostTab(strip: HTMLElement, tab: HTMLElement, place: Place): void {
  const ghost = document.createElement("div");
  ghost.className = "tab-ghost";
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.toggle("is-active", tab.classList.contains("is-active"));
  ghost.classList.toggle("is-clipped", tab.classList.contains("is-clipped"));
  ghost.append(...tab.childNodes);
  ghost.style.insetInlineStart = `${place.left}px`;
  ghost.style.inlineSize = `${place.width}px`;
  strip.append(ghost);
  fadeAway(ghost, timing("--t-exit", "--ease-out"));
}

function settleTabs(strip: HTMLElement, before: Map<number, HTMLElement>, was: Map<number, Place>): void {
  const after = tabsIn(strip);
  const entering = timing("--t-menu", "--ease-in-out");
  for (const [id, el] of after) if (!before.has(id)) arrive(el, entering);
  if (reducedMotion()) return;
  for (const [id, el] of before) if (!after.has(id)) ghostTab(strip, el, was.get(id)!);
  glide(after, was, strip, timing("--t-menu", "--ease-in-out"));
}

/** Draws the tab strip. A pointer change to which tabs there are moves them; anything else simply appears. */
export function renderTabStrip(strip: HTMLElement, workspace: Workspace, labelOf: (view: View) => string): void {
  const before = tabsIn(strip);
  const was = placesOf(before, strip);
  const motion = isPointerAction() && before.size > 0 && (shapeChanged(before, workspace) || isSettling(strip));
  const frag = document.createDocumentFragment();
  workspace.tabs.forEach((tab, i) => {
    const active = i === workspace.activeIndex;
    const view = tab.trail.current.view;
    const title = labelOf(view);
    const el = document.createElement("div");
    el.className = `tab${active ? " is-active" : ""}`;
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.dataset.tab = String(i);
    el.dataset.tabId = String(tab.id);
    el.dataset.tip = title;
    el.classList.toggle("is-graph-tab", view.kind === "graph");
    el.classList.toggle("is-pinned", !!tab.pinned);
    el.innerHTML = tab.pinned
      ? `<span class="tab-pin" aria-label="Pinned">${icons.pin}</span><span class="tab-title"></span>`
      : `<button class="icon-btn tab-close" data-tab-close aria-label="Close tab">${icons.close}</button><span class="tab-title"></span>`;
    el.querySelector(".tab-title")!.textContent = title;
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
  if (motion) frag.append(...strip.querySelectorAll(":scope > .tab-ghost"));
  strip.replaceChildren(frag);
  if (motion) {
    fitTabs(strip);
    settleTabs(strip, before, was);
  } else {
    requestAnimationFrame(() => fitTabs(strip));
  }
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
  const titles = [...strip.querySelectorAll<HTMLElement>(".tab .tab-title")];
  const natural = titles.map((title) => Math.min(textWidth(title) + TAB_CHROME, MAX_NATURAL_TAB));
  const limit = tabWidthLimit(natural, strip.clientWidth - STRIP_CHROME - TAB_GAP * titles.length);
  if (limit === null) strip.style.removeProperty("--tab-limit");
  else strip.style.setProperty("--tab-limit", `${limit}px`);
  for (const tab of strip.querySelectorAll<HTMLElement>(".tab")) {
    const title = tab.querySelector<HTMLElement>(".tab-title")!;
    tab.classList.toggle("is-clipped", title.scrollWidth > title.clientWidth + 1);
  }
}
