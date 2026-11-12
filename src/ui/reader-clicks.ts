import { isDesktop, native } from "../platform";
import { isPointerAction } from "./input-origin";
import type { RailPane } from "./inspector";
import { chooseAmbiguous, copyCode, toggleCallout } from "./note-actions";
import { markTarget } from "./note-view";
import { lightbox } from "./overlays";
import type { RailSection } from "./panel-sections";
import type { Reader } from "./reader";
import { glideTo, yieldGlideTo } from "./scroll-glide";
import { bindSwipeNavigation } from "./swipe-navigation";

type Route = [selector: string, handle: (el: HTMLElement, e: MouseEvent) => void];

const PEEKS = ["sidebar-peek", "rail-peek"];
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

function closeTabOf(r: Reader, el: HTMLElement): void {
  r.closeTab(Number(el.closest<HTMLElement>(".tab")!.dataset.tab));
}

function followLink(r: Reader, shell: HTMLElement, link: HTMLElement, e: MouseEvent): void {
  if (link.closest(".sidebar")) shell.classList.remove(...PEEKS);
  e.preventDefault();
  r.preview.hide();
  if (link.classList.contains("is-ambiguous")) {
    const candidates = JSON.parse(link.dataset.candidates!) as string[];
    chooseAmbiguous(link, candidates, r.vault.index, (path) => {
      void r.open(path, { newTab: e.metaKey, focus: true, anchor: link.dataset.anchor });
    });
    return;
  }
  if (!link.dataset.path) return;
  const newTab = e.metaKey || e.button === 1;
  void r.open(link.dataset.path, {
    anchor: link.dataset.anchor,
    newTab,
    focus: newTab ? e.shiftKey : true,
    via: link.classList.contains("nav-item") ? "jump" : "link",
  });
}

function routes(r: Reader, shell: HTMLElement): Route[] {
  return [
    ["[data-tab-close]", (el) => closeTabOf(r, el)],
    ['[data-act="search-clear"]', () => r.sidebar.searchPane.clear()],
    ["[data-act]", (el) => r.commands.run(el.dataset.act!, "click")],
    [".tab", (el, e) => (e.button === 1 ? closeTabOf(r, el) : r.switchTab(Number(el.dataset.tab)))],
    ["[data-side]", () => r.sidebar.toggleSearch()],
    [".tree-head", (el) => r.sidebar.tree.toggle(el.dataset.folder!)],
    ["[data-crumb]", (el) => r.sidebar.revealFolder(el.dataset.crumb!)],
    [
      "[data-rail]",
      (el) => {
        const pane = el.dataset.rail as RailPane;
        r.deps.prefs.update((p) => {
          p.railPane = pane;
        });
        r.inspector.setPane(pane);
      },
    ],
    ["[data-fold-section]", (el) => r.inspector.sections.toggle(el.dataset.foldSection as RailSection)],
    [".search-hit", (el, e) => r.sidebar.searchPane.openHit(Number(el.dataset.hit), e.metaKey)],
    [".doc button.task-box[data-task-line]", (el) => void r.editing.toggleTask(el)],
    [".code-copy", (el) => void copyCode(el as HTMLButtonElement, () => r.deps.sound.play("copy"))],
    ["button.callout-title", (el) => toggleCallout(el)],
    [".diagram-expand", (el) => lightbox(el.closest(".diagram")!.querySelector("svg")!.cloneNode(true) as Element)],
    ["img.embed-image", (el) => lightbox(el.cloneNode() as Element)],
    [
      ".floating-outline a",
      (el, e) => {
        e.preventDefault();
        const heading = document.getElementById(el.dataset.target!);
        if (heading)
          glideTo(r.els.scroller, heading, (inMs) => {
            if (isPointerAction()) markTarget(heading, inMs);
          });
      },
    ],
    ["a.wikilink, a.wikilink-plain, .nav-item[data-path]", (el, e) => followLink(r, shell, el, e)],
    [
      "a.attachment-link, a.embed-file",
      (el, e) => {
        e.preventDefault();
        if (isDesktop) void native.reveal(el.dataset.attachment ?? undefined);
        else window.open((el as HTMLAnchorElement).href, "_blank", "noopener");
      },
    ],
    [
      ".doc a[href^='http'], .doc a[href^='mailto:']",
      (el, e) => {
        e.preventDefault();
        void native.openExternal((el as HTMLAnchorElement).href);
      },
    ],
    [".doc a[href^='vault:']", (_el, e) => e.preventDefault()],
    [
      ".remote-image",
      (el) => {
        if (el.dataset.src) void native.openExternal(el.dataset.src);
      },
    ],
  ];
}

/** Routes clicks inside the window. The first match wins, so specific targets precede the elements containing them. */
export function bindReaderClicks(shell: HTMLElement, reader: Reader): void {
  const table = routes(reader, shell);
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".sidebar, .rail, [data-act]")) shell.classList.remove(...PEEKS);
    for (const [selector, handle] of table) {
      const el = target.closest<HTMLElement>(selector);
      if (!el) continue;
      if (el.matches("[data-act], [data-tab-close]")) e.preventDefault();
      handle(el, e);
      return;
    }
  };
  shell.addEventListener("click", onClick);
  shell.addEventListener("auxclick", (e) => {
    if (e.button === 1) onClick(e);
  });
  shell.addEventListener("mouseup", (e) => {
    if (e.button !== MOUSE_BACK && e.button !== MOUSE_FORWARD) return;
    e.preventDefault();
    reader.commands.run(e.button === MOUSE_BACK ? "back" : "forward", "click");
  });
  yieldGlideTo(reader.els.scroller);
  bindSwipeNavigation(reader.els.scroller, {
    can: (step) => {
      if (reader.workspace.isEmpty || reader.onBlank) return false;
      const { trail } = reader.workspace.active;
      return step < 0 ? trail.canBack : trail.canForward;
    },
    go: (step) => reader.commands.run(step < 0 ? "back" : "forward", "click"),
  });
}
