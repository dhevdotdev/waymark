import { isDesktop } from "../platform";
import { icons } from "./icons";

export interface ShellElements {
  shell: HTMLElement;
  tabs: HTMLElement;
  sidebar: HTMLElement;
  searchPane: HTMLElement;
  sidebarResize: HTMLElement;
  railResize: HTMLElement;
  reader: HTMLElement;
  scroller: HTMLElement;
  paneHead: HTMLElement;
  crumbs: HTMLElement;
  paneMeta: HTMLElement;
  trailPane: HTMLElement;
  editState: HTMLElement;
  modeSwitch: HTMLElement;
  statusStats: HTMLElement;
  links: HTMLElement;
  info: HTMLElement;
  railBody: HTMLElement;
  railGraph: HTMLElement;
  back: HTMLButtonElement;
  forward: HTMLButtonElement;
  graphButton: HTMLElement;
  sync: HTMLButtonElement;
  branch: HTMLElement;
}

export interface ShellOptions {
  sidebarOpen: boolean;
  railOpen: boolean;
  sidebarWidth: number;
  railWidth: number;
}

function template(options: ShellOptions): string {
  const classes = [
    "shell",
    options.sidebarOpen ? "" : "sidebar-closed",
    options.railOpen ? "" : "rail-closed",
    isDesktop ? "is-desktop" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${classes}" style="--sidebar-w:${options.sidebarWidth}px;--rail-w:${options.railWidth}px">
      <header class="titlebar" data-tauri-drag-region>
        ${isDesktop ? "" : `<div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>`}
        <div class="titlebar-lead" data-tauri-drag-region>
          <button class="icon-btn" data-act="sidebar" data-tip="Sidebar" data-key="⌘\\" aria-label="Toggle sidebar">${icons.sidebar}</button>
          <span class="wordmark" data-tauri-drag-region>Waymark</span>
          <div class="titlebar-nav">
            <button class="icon-btn" data-act="back" data-tip="Back" data-key="⌘[" aria-label="Back">${icons.back}</button>
            <button class="icon-btn" data-act="forward" data-tip="Forward" data-key="⌘]" aria-label="Forward">${icons.forward}</button>
          </div>
        </div>
        <div class="tabs" role="tablist" data-tauri-drag-region></div>
        <div class="titlebar-trail">
          <div class="titlebar-tools">
            <button class="icon-btn has-count" data-act="rail-links" data-rail="links" data-tip="Links" aria-label="Links" aria-pressed="false" aria-controls="inspector">${icons.link}<span class="icon-count"></span></button>
            <button class="icon-btn" data-act="rail-info" data-rail="info" data-tip="Info" aria-label="Info" aria-pressed="false" aria-controls="inspector">${icons.info}</button>
            <button class="icon-btn" data-act="note-menu" data-tip="More" aria-label="More actions for this note" aria-haspopup="menu" aria-expanded="false">${icons.more}</button>
          </div>
        </div>
      </header>
      <nav class="sidebar" aria-label="Navigation">
        <div class="files-actions" data-side-pane="files">
          <button class="icon-btn" data-act="new-note" data-tip="New note" data-key="⌘N" aria-label="New note">${icons.newNote}</button>
          <button class="icon-btn" data-act="new-folder" data-tip="New folder" aria-label="New folder">${icons.newFolder}</button>
          <button class="icon-btn" data-act="sort-files" data-tip="Sort notes" aria-label="Sort notes">${icons.sort}</button>
          <button class="icon-btn files-actions-end" data-side="search" data-tip="Search inside notes" data-key="⌘⇧F" aria-label="Search inside notes">${icons.search}</button>
          <button class="icon-btn" data-act="collapse-folders" data-tip="Collapse all folders" aria-label="Collapse all folders">${icons.collapse}</button>
        </div>
        <div class="sidebar-inner" data-side-pane="files"></div>
        <div class="sidebar-search" data-side-pane="search" inert>
          <div class="search-head">
            <div class="search-field">${icons.search}<input type="text" spellcheck="false" autocomplete="off" placeholder="Search inside notes" aria-label="Search inside notes" /><button class="icon-btn" data-act="search-clear" aria-label="Clear search">${icons.close}</button></div>
          </div>
          <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
        </div>
        <div class="sidebar-resize" aria-hidden="true"></div>
      </nav>
      <main class="reader">
        <div class="pane-head"><div class="crumbs"></div><span class="edit-state" data-state="saved" aria-live="polite"></span><span class="pane-meta"></span><div class="seg mode-switch" role="group" aria-label="Reading or editing"><button class="seg-btn is-on" data-act="mode-read" data-tip="Read" data-key="⌘E" aria-pressed="true">Read</button><button class="seg-btn" data-act="mode-edit" data-tip="Edit" data-key="⌘E" aria-pressed="false">Edit</button></div></div>
        <div class="scroller" tabindex="-1"><article class="doc"></article></div>
      </main>
      <aside class="rail" id="inspector" aria-label="Inspector">
        <div class="rail-resize" aria-hidden="true"></div>
        <div class="rail-inner">
          <div class="rail-body">
            <div class="rail-pane rail-links" data-pane="links"></div>
            <div class="rail-pane rail-info" data-pane="info"></div>
          </div>
          <section class="rail-section" data-section="trail" aria-label="This tab's trail">
            <div class="rail-section-head"><button class="rail-section-toggle" data-fold-section="trail"><svg class="rail-section-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg><span class="rail-section-name">Trail</span></button></div>
            <div class="rail-section-body rail-trail"></div>
          </section>
          <section class="rail-section" data-section="graph" aria-label="Local graph">
            <div class="rail-section-head"><button class="rail-section-toggle" data-fold-section="graph"><svg class="rail-section-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg><span class="rail-section-name">Graph</span></button><button class="icon-btn rail-graph-open" data-act="graph-local" data-tip="Open as a full graph" data-key="⌘⇧G" aria-label="Open as a full graph"></button></div>
            <div class="rail-section-body rail-graph"></div>
          </section>
        </div>
      </aside>
      <footer class="statusbar">
        <div class="status-lead">
          <span class="status-branch" hidden>${icons.branch}<span></span></span>
          <button class="sync-btn" data-act="sync-panel" aria-label="Sync status"><span class="sync-dot"></span><span class="sync-label">Local</span></button>
        </div>
        <div class="status-trail">
          <span class="status-stats" hidden></span>
          <button class="icon-btn appearance-btn" data-act="appearance" data-tip="Light or dark" aria-label="Switch between light and dark"><span class="when-dark">${icons.sun}</span><span class="when-light">${icons.moon}</span></button>
          <button class="icon-btn" data-act="graph" data-tip="Graph" data-key="⌘G" aria-label="Graph view">${icons.graph}</button>
          <button class="icon-btn" data-act="settings" data-tip="Appearance and sync" data-key="⌘," aria-label="Appearance and sync">${icons.sliders}</button>
        </div>
      </footer>
    </div>`;
}

/** Replaces `host` with an empty window frame and returns its parts. */
export function mountShell(host: HTMLElement, options: ShellOptions): ShellElements {
  host.innerHTML = template(options);
  const q = <T extends HTMLElement>(selector: string) => host.querySelector(selector) as T;
  return {
    shell: q(".shell"),
    tabs: q(".tabs"),
    sidebar: q(".sidebar-inner"),
    searchPane: q(".sidebar-search"),
    sidebarResize: q(".sidebar-resize"),
    railResize: q(".rail-resize"),
    reader: q(".reader"),
    scroller: q(".scroller"),
    paneHead: q(".pane-head"),
    crumbs: q(".crumbs"),
    paneMeta: q(".pane-meta"),
    trailPane: q(".rail-trail"),
    editState: q(".edit-state"),
    modeSwitch: q(".mode-switch"),
    statusStats: q(".status-stats"),
    links: q(".rail-links"),
    info: q(".rail-info"),
    railBody: q(".rail-body"),
    railGraph: q(".rail-graph"),
    back: q('[data-act="back"]'),
    forward: q('[data-act="forward"]'),
    graphButton: q('[data-act="graph"]'),
    sync: q(".sync-btn"),
    branch: q(".status-branch"),
  };
}
