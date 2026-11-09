import type { View } from "../vault/trail";
import type { Workspace } from "../vault/workspace";
import { icons } from "./icons";
import { reducedMotion } from "./media";

const MAX_NATURAL_TAB = 320;

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
}

/** Tabs keep their natural width while they fit; once crowded they share the strip equally. */
function fitTabs(strip: HTMLElement): void {
  const natural = [...strip.querySelectorAll<HTMLElement>(".tab-title")].reduce(
    (sum, title) => sum + Math.min(title.scrollWidth + 40, MAX_NATURAL_TAB) + 2,
    32,
  );
  strip.classList.toggle("is-crowded", natural > strip.clientWidth);
  for (const tab of strip.querySelectorAll<HTMLElement>(".tab")) {
    const title = tab.querySelector<HTMLElement>(".tab-title")!;
    tab.classList.toggle("is-clipped", title.scrollWidth > title.clientWidth + 1);
  }
}
