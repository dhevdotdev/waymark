import { isDesktop } from "../platform";
import { icons } from "./icons";

export interface ShellElements {
  shell: HTMLElement;
  tabs: HTMLElement;
  sidebar: HTMLElement;
  searchPane: HTMLElement;
  sidebarResize: HTMLElement;
  reader: HTMLElement;
  scroller: HTMLElement;
  paneHead: HTMLElement;
  crumbs: HTMLElement;
  paneMeta: HTMLElement;
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
    <div class="${classes}" style="--sidebar-w:${options.sidebarWidth}px">
      <header class="titlebar" data-tauri-drag-region>
        ${isDesktop ? "" : `<div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>`}
        <div class="titlebar-lead" data-tauri-drag-region>
          <div class="titlebar-nav">
            <button class="icon-btn" data-act="sidebar" data-tip="Sidebar" data-key="⌘\\" aria-label="Toggle sidebar">${icons.sidebar}</button>
            <button class="icon-btn" data-side="search" data-tip="Search inside notes" data-key="⌘⇧F" aria-label="Search inside notes">${icons.search}</button>
            <button class="icon-btn" data-act="new-note" data-tip="New note" data-key="⌘N" aria-label="New note">${icons.newNote}</button>
          </div>
          <div class="titlebar-nav">
            <button class="icon-btn" data-act="back" data-tip="Back" data-key="⌘[" aria-label="Back">${icons.back}</button>
            <button class="icon-btn" data-act="forward" data-tip="Forward" data-key="⌘]" aria-label="Forward">${icons.forward}</button>
          </div>
        </div>
        <div class="tabs" role="tablist" data-tauri-drag-region></div>
        <div class="titlebar-trail">
          <button class="icon-btn" data-act="rail" data-tip="Inspector" data-key="⌥⌘\\" aria-label="Toggle inspector">${icons.inspector}</button>
        </div>
      </header>
      <nav class="sidebar" aria-label="Navigation">
        <div class="sidebar-inner" data-side-pane="files"></div>
        <div class="sidebar-search" data-side-pane="search" hidden>
          <div class="search-head">
            <div class="search-field">${icons.search}<input type="text" spellcheck="false" autocomplete="off" placeholder="Search inside notes" aria-label="Search inside notes" /><button class="icon-btn" data-act="search-clear" aria-label="Clear search">${icons.close}</button></div>
          </div>
          <div class="search-results" role="listbox" aria-label="Search results"></div>
        </div>
        <div class="sidebar-resize" aria-hidden="true"></div>
      </nav>
      <main class="reader">
        <div class="pane-head"><div class="crumbs"></div><span class="edit-state" data-state="saved" aria-live="polite"></span><span class="pane-meta"></span><div class="seg mode-switch" role="group" aria-label="Reading or editing"><button class="seg-btn is-on" data-act="mode-read" data-tip="Read" data-key="⌘E" aria-pressed="true">Read</button><button class="seg-btn" data-act="mode-edit" data-tip="Edit" data-key="⌘E" aria-pressed="false">Edit</button></div></div>
        <div class="scroller" tabindex="-1"><article class="doc"></article></div>
      </main>
      <aside class="rail" aria-label="Inspector">
        <div class="rail-inner">
          <div class="seg seg-full rail-tabs" role="tablist">
            <button class="seg-btn" role="tab" data-rail="links">Links</button>
            <button class="seg-btn" role="tab" data-rail="info">Info</button>
          </div>
          <div class="rail-body">
            <div class="rail-pane rail-links" data-pane="links"></div>
            <div class="rail-pane rail-info" data-pane="info"></div>
          </div>
          <div class="rail-graph"></div>
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
    reader: q(".reader"),
    scroller: q(".scroller"),
    paneHead: q(".pane-head"),
    crumbs: q(".crumbs"),
    paneMeta: q(".pane-meta"),
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
