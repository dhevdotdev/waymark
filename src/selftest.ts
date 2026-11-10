import { git, native } from "./platform";
import { runEmpty, runOrganize } from "./selftest-organize";
import { runBackup, runConflict, runLibrary, runRelaunch, runRestore, type SelfTestContext } from "./selftest-recovery";
import type { App } from "./ui/app";

async function runShow(ctx: SelfTestContext, mode: string): Promise<void> {
  const { app, reader, vault, panel, check, wait } = ctx;
  const [, note, extra, scheme] = mode.split(":");
  if (scheme === "light" || scheme === "dark") app.setAppearance(scheme);
  const res = vault.index.resolve(note);
  if (res.kind === "found") await app.open(res.path);
  await wait(800);
  if (extra === "graph") reader.openGraph("vault");
  if (extra === "palette") reader.palette.open("the");
  if (extra === "sync") panel.open();
  if (extra === "search") reader.sidebar.showSearch("the");
  await wait(2500);
  check("shown", true);
}

async function checkDockIcons({ app, check }: SelfTestContext): Promise<void> {
  const accepted = (family: string) =>
    native.setDockIcon(family).then(
      () => true,
      () => false,
    );
  for (const family of app.themeFamilies) check(`macOS accepts the ${family} Dock icon`, await accepted(family));
  check("a family with no icon is refused", !(await accepted("no-such-family")));
  const colourSet = await native.setWindowColor([30, 30, 46]).then(
    () => true,
    () => false,
  );
  check("the window colour can follow the theme", colourSet);
  check("the key sounds load under the content policy", await app.sound.keys.load("tactile"));
}

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Proves the write path and the editor in the packaged app, where CSP and IPC apply. */
async function checkEditing({ app, reader, vault, check, until }: SelfTestContext): Promise<void> {
  const note = "Selftest edits.md";
  const body = "# Edits\n\n- [ ] first\n- [x] second\n\nPlain text.\n";
  const created = await vault.save(note, body, null);
  check("a new note can be written", created.kind === "saved", created);
  await until(() => vault.index.notes.includes(note));
  await app.open(note);
  await until(() => document.querySelector("button.task-box") !== null);
  document.querySelector<HTMLElement>("button.task-box")?.click();
  await until(() => vault.texts.get(note)?.includes("- [x] first") ?? false);
  check("clicking a task writes it to disk", (await vault.source.readText(note)).includes("- [x] first"));
  await reader.editing.open();
  const editor = document.querySelector<HTMLElement>(".cm-content");
  check("the editor opens", editor !== null);
  check(
    "the editor's styles load under CSP",
    editor?.closest(".cm-editor") ? getComputedStyle(editor.closest(".cm-editor")!).display === "flex" : false,
  );
  editor?.focus();
  document.execCommand("insertText", false, "Typed in the app. ");
  await until(
    () =>
      document.querySelector<HTMLElement>(".edit-state")?.dataset.state === "saved" &&
      (vault.texts.get(note)?.includes("Typed in the app") ?? false),
  );
  const disk = await vault.source.readText(note);
  check("typing reaches the disk", disk.includes("Typed in the app"), disk.length);
  check("the rest of the note is untouched", disk.includes("- [x] second\n\nPlain text.\n"));
  await reader.editing.finish();
  check("reading shows the edit", document.querySelector(".doc")?.textContent?.includes("Typed in the app") ?? false);
  const refused = await vault.save("../outside.md", "x", null).then(
    () => false,
    () => true,
  );
  check("a write outside the vault is refused", refused);
  const png = Uint8Array.from(atob(TINY_PNG), (c) => c.charCodeAt(0));
  await vault.source.writeAttachment("Selftest files/dot.png", png);
  check("an image can be added", (await vault.source.list()).includes("Selftest files/dot.png"));
  const replaced = await vault.source.writeAttachment("Selftest files/dot.png", png).then(
    () => true,
    () => false,
  );
  check("an image is never replaced", !replaced);
  check("Obsidian's settings can be read", typeof (await vault.source.settings()).attachmentFolder === "string");
  await reader.files.renameTo(note, "Selftest renamed");
  check("a note can be renamed", (await vault.source.list()).includes("Selftest renamed.md"));
  check("the open tab follows the rename", reader.current === "Selftest renamed.md", reader.current);
  await vault.source.trashNote("Selftest renamed.md");
  check("a note can be moved to the Trash", !(await vault.source.list()).includes("Selftest renamed.md"));
  await vault.applyChanges([]);
}

/** Code colours, diagrams and math in the editor, where CSP could stop any of them. */
async function checkEditPreview({ app, reader, vault, check, until }: SelfTestContext): Promise<void> {
  const note = "Selftest blocks.md";
  const fence = "```";
  const body = `# Blocks\n\nInline $x^2$ math.\n\n${fence}java\nclass A { int x = 1; }\n${fence}\n\n${fence}mermaid\ngraph TD; A-->B;\n${fence}\n\n$$\ny^2\n$$\n\nEnd.\n`;
  await vault.save(note, body, null);
  await until(() => vault.index.notes.includes(note));
  await app.open(note);
  await reader.editing.open();
  await until(() => document.querySelector(".cm-preview-block .diagram-svg svg") !== null, 15000);
  check("a diagram is drawn in the editor", document.querySelector(".cm-preview-block .diagram-svg svg") !== null);
  const colours = new Set([...document.querySelectorAll(".cm-code-token")].map((token) => getComputedStyle(token).color));
  check("code has several colours in the editor", colours.size >= 3, [...colours].join(" "));
  check("display math is drawn in the editor", document.querySelector(".cm-math-block .katex-html") !== null);
  check("inline math is drawn in the editor", document.querySelector(".cm-math-inline .katex-html") !== null);
  await reader.editing.finish();
  check("drawing them leaves the note as it was", (await vault.source.readText(note)) === body);
  await vault.source.trashNote(note);
  await vault.applyChanges([]);
}

/** Whole words must not jump between lines above the cursor. Only the system WebKit reflows this way, so only this check can see it. */
async function checkLinesHoldStill({ app, reader, vault, check, until, wait }: SelfTestContext): Promise<void> {
  const note = "Selftest wrap.md";
  const text =
    "The idea here is to build apps that would help boost my identity in particular and it goes on for a good while longer than one line can hold, so that the note wraps over several lines of the column before the end of it";
  await vault.save(note, `${text}\n`, null);
  await until(() => vault.index.notes.includes(note));
  await app.open(note);
  await wait(300);
  await reader.editing.open();
  await wait(300);
  const line = () =>
    [...document.querySelectorAll<HTMLElement>(".cm-line")].find((row) => row.textContent?.includes("The idea"))!;
  const breaks = () => {
    const found: number[] = [];
    const walker = document.createTreeWalker(line(), NodeFilter.SHOW_TEXT);
    let top: number | null = null;
    let offset = 0;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      for (let i = 0; i < node.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (!rect.height) continue;
        if (top !== null && rect.top > top + 4) found.push(offset + i);
        top = rect.top;
      }
      offset += node.length;
    }
    return found;
  };
  document.querySelector<HTMLElement>(".cm-content")?.focus();
  const walker = document.createTreeWalker(line(), NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) last = node;
  if (last) getSelection()?.collapse(last, last.length);
  await wait(120);
  let before = breaks();
  let moved = 0;
  for (const letter of " and then the writing keeps going with more words so that the line grows and wraps again") {
    document.execCommand("insertText", false, letter);
    await wait(25);
    const after = breaks();
    const settled = Math.min(before.length, after.length) - 1;
    for (let i = 0; i < settled; i++) if (Math.abs(after[i] - before[i]) >= 2) moved++;
    before = after;
  }
  check("typing never moves words on the lines above", moved === 0, moved);
  await reader.editing.finish();
  await vault.source.trashNote(note);
  await vault.applyChanges([]);
}

/** Renaming and deleting folders in the packaged app, where the native commands run. */
async function checkFolders({ reader, vault, check, until }: SelfTestContext): Promise<void> {
  const inside = "Selftest folder/Inside.md";
  const linker = "Selftest linker.md";
  await vault.save(inside, "inside\n", null);
  await vault.save(linker, "[[Selftest folder/Inside]] [m](Selftest%20folder/Inside.md)\n", null);
  await until(() => vault.index.notes.includes(inside) && vault.index.notes.includes(linker));
  await reader.files.renameFolder("Selftest folder", "Selftest moved");
  const files = await vault.source.list();
  check("a folder can be renamed", files.includes("Selftest moved/Inside.md") && !files.includes(inside));
  check(
    "links follow a renamed folder",
    (await vault.source.readText(linker)) === "[[Selftest moved/Inside]] [m](Selftest%20moved/Inside.md)\n",
  );
  const refused = (path: string) =>
    vault.source.trashFolder(path).then(
      () => false,
      () => true,
    );
  check("the vault itself cannot be trashed", await refused(""));
  check("a hidden folder cannot be trashed", await refused(".git"));
  check("a folder outside the vault cannot be trashed", await refused("../outside"));
  await vault.source.trashFolder("Selftest moved");
  check("a folder can be moved to the Trash", !(await vault.source.list()).includes("Selftest moved/Inside.md"));
  await vault.source.trashNote(linker);
  await vault.applyChanges([]);
}

async function runRead(ctx: SelfTestContext): Promise<void> {
  const { app, reader, vault, check, wait, until, log, report } = ctx;
  await checkDockIcons(ctx);
  await checkEditing(ctx);
  await checkEditPreview(ctx);
  await checkLinesHoldStill(ctx);
  await checkFolders(ctx);
  const sample = vault.index.attachments.find((p) => /\.png$/i.test(p));
  if (sample) {
    const url = vault.source.assetUrl(sample);
    const img = new Image();
    img.src = url;
    await until(() => img.complete, 4000);
    log(`asset img ${img.naturalWidth}x${img.naturalHeight}`);
    const picture = "Selftest picture.md";
    await vault.save(picture, `![[${sample}]]\n`, null);
    await until(() => vault.index.notes.includes(picture));
    await app.open(picture);
    await until(() => document.querySelector(".doc img.is-sized") !== null, 3000);
    check("an image has its size before it is shown", document.querySelector(".doc img.is-sized") !== null);
    await vault.source.trashNote(picture);
    await vault.applyChanges([]);
  }
  const failures: string[] = [];
  const times: number[] = [];
  let diagrams = 0;
  let diagramErrors = 0;
  let images = 0;
  let brokenImages = 0;
  for (const path of vault.index.notes) {
    try {
      await app.open(path);
      times.push(app.metrics.lastRenderMs);
      const doc = document.querySelector(".doc")!;
      diagrams += doc.querySelectorAll(".diagram-svg").length;
      diagramErrors += doc.querySelectorAll(".diagram-error").length;
      const imgs = [...doc.querySelectorAll<HTMLImageElement>("img.embed-image")];
      for (const img of imgs) {
        img.loading = "eager";
        await until(() => img.complete, 4000);
        images++;
        if (!img.naturalWidth) brokenImages++;
      }
    } catch (err) {
      failures.push(`${path}: ${(err as Error).message}`);
    }
  }
  times.sort((x, y) => x - y);
  const pct = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))] * 10) / 10;
  report.render = { notes: times.length, p50: pct(0.5), p95: pct(0.95), max: pct(1) };
  check("every note renders", failures.length === 0, failures.slice(0, 5));
  check("vault:// images load", images > 0 && brokenImages === 0, { images, brokenImages });
  const expectsDiagrams = [...vault.texts.values()].some((text) => text.includes("```mermaid"));
  check("diagrams render", !expectsDiagrams || diagrams > 0, { diagrams, diagramErrors });

  const t0 = performance.now();
  const term = [...vault.texts.values()].join(" ").match(/[a-z]{8,}/i)?.[0] ?? "";
  const hits = vault.search.search(term, 20);
  report.searchMs = Math.round((performance.now() - t0) * 10) / 10;
  check("search finds text", hits.length > 0, hits.length);

  const st = await git.status();
  check("git status over IPC", st.isRepo, {
    branch: st.branch,
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    changed: st.files.length,
  });
  const target = vault.index.notes[0];
  const history = await git.log(target, 10, 0);
  check("per-note history", history.length > 0, history.length);
  if (history[0]) {
    const diff = await git.show(history[0].sha, history[0].path ?? target);
    check("commit diff for a note", diff.includes("@@"), diff.length);
  }
  const external = performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((u) => !/^(vault|ipc|tauri|http:\/\/(ipc|tauri|vault)\.localhost)/.test(u) && !u.startsWith(location.origin));
  check("no requests leave the machine", external.length === 0, external.slice(0, 5));

  await app.open(target);
  reader.inspector.setPane("info");
  await until(() => !!document.querySelector(".rail-history .rail-commit"), 4000);
  const firstCommit = document.querySelector<HTMLElement>(".rail-history .rail-commit");
  check(
    "the Info pane lists this note's Git history",
    !!firstCommit,
    document.querySelectorAll(".rail-history .rail-commit").length,
  );
  check("a short history lists every version", document.querySelector(".rail-commit-more") === null);
  await app.open("Long history.md");
  await until(() => !!document.querySelector(".rail-commit-more"), 4000);
  check(
    "a long history lists thirty rows",
    document.querySelectorAll(".rail-history .rail-commit:not(.rail-commit-more)").length === 30,
  );
  check("and offers the rest", document.querySelector(".rail-commit-more")?.textContent === "Show all 35 versions");
  await app.open(target);
  await until(
    () => document.querySelector(".rail-commit-more") === null && !!document.querySelector(".rail-history .rail-commit"),
    4000,
  );
  document.querySelector<HTMLElement>(".rail-history .rail-commit")?.click();
  await until(() => !!document.querySelector(".sheet-overlay"), 4000);
  check(
    "a history entry opens that commit's change",
    !!document.querySelector(".sheet-overlay .diff, .sheet-overlay .sheet-body *"),
  );
  check("a history entry offers the old version", !!document.querySelector(".sheet-actions .btn"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await wait(250);
  reader.inspector.setPane("links");

  for (const stop of vault.index.notes.filter((n) => n !== target).slice(0, 2))
    await reader.open(stop, { via: "link", focus: true });
  const titleTop = () => document.querySelector(".doc-title")?.getBoundingClientRect().top;
  const before = titleTop();
  check(
    "the trail shows with the links and the graph",
    reader.inspector.sections.isOpen("trail") && reader.inspector.sections.isOpen("graph"),
  );
  reader.inspector.sections.setFolded("trail", true);
  reader.trail.togglePanel();
  await wait(350);
  check(
    "the shortcut opens the trail",
    reader.inspector.sections.isOpen("trail") && document.querySelectorAll(".trail-row").length === 3,
  );
  check("opening the trail leaves the note where it was", titleTop() === before, titleTop());
  document.querySelector<HTMLElement>(".trail-row:not(.is-current)")?.click();
  await wait(400);
  check("clicking a stop moves the tab and leaves the trail open", reader.inspector.sections.isOpen("trail"));
  reader.trail.togglePanel();
  await wait(100);
  check("the shortcut puts the trail back", !reader.inspector.sections.isOpen("trail"));
  reader.inspector.sections.setFolded("trail", false);
  reader.openGraph("vault");
  await wait(1500);
  check("graph opens", !!document.querySelector(".graph-view canvas"));
  reader.leaveGraph();
}

async function runGit(ctx: SelfTestContext, played: string[]): Promise<void> {
  const { panel, vault, check, until, wait } = ctx;
  await panel.refresh();
  check("status before fetch shows nothing incoming", panel.status?.behind === 0, panel.status?.branch);
  await panel.fetch(true);
  check("fetch sees incoming commits", panel.status?.behind === 1, { behind: panel.status?.behind });
  await panel.sync();
  check("sync fast-forwards", panel.status?.behind === 0 && panel.state.kind === "idle", {
    behind: panel.status?.behind,
    state: panel.state.kind,
  });
  await until(() => vault.texts.get("Welcome.md")?.includes("updated remotely") ?? false, 4000);
  check("watcher re-reads the updated note", vault.texts.get("Welcome.md")?.includes("updated remotely") ?? false);
  check("open note re-rendered", document.querySelector(".doc")?.textContent?.includes("updated remotely") ?? false);
  check("incoming changes play the incoming cue", played.includes("incoming"), played);
  panel.open();
  await wait(300);
  const sheet = document.querySelector(".sync-sheet")?.getBoundingClientRect();
  const centred = sheet
    ? Math.abs(sheet.left + sheet.width / 2 - innerWidth / 2) <= 2 &&
      Math.abs(sheet.top + sheet.height / 2 - innerHeight / 2) <= 2
    : false;
  check("the sync sheet opens in the centre of the window", centred, sheet);
  check("the sync sheet is not part of the reading pane", !document.querySelector(".reader .sync-sheet"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await wait(300);
  check("Escape closes the sync sheet", !panel.isOpen && !document.querySelector(".sync-overlay"));
}

async function runCommit({ panel, vault, check, until, wait }: SelfTestContext): Promise<void> {
  await panel.refresh();
  const saved = await vault.save("Written here.md", "# Written here\n", null);
  check("the note is saved", saved.kind === "saved", saved);
  await panel.refresh();
  panel.open();
  await until(() => [...document.querySelectorAll(".sync-sheet .link-btn")].some((b) => b.textContent === "Stage all"));
  await wait(500);
  const tabsAt = () => Math.round(document.querySelector(".sync-sheet .seg")?.getBoundingClientRect().top ?? -1);
  const seen = new Set([tabsAt()]);
  [...document.querySelectorAll<HTMLElement>(".sync-sheet .link-btn")].find((b) => b.textContent === "Stage all")?.click();
  while (panel.state.kind === "busy") {
    seen.add(tabsAt());
    await new Promise((frame) => requestAnimationFrame(frame));
  }
  seen.add(tabsAt());
  check("staging moves nothing in the sync panel", seen.size === 1, [...seen]);
  panel.close();
  await panel.commitAndSync("From Waymark");
  const after = await git.status();
  check("commit and sync leaves nothing pending", after.ahead === 0 && after.behind === 0 && after.files.length === 0, after);
  check("the sync finished cleanly", panel.state.kind === "idle", panel.state);
  await until(() => vault.texts.get("Welcome.md")?.includes("updated remotely") ?? false, 4000);
  check("incoming commits came in first", vault.texts.get("Welcome.md")?.includes("updated remotely") ?? false);
  check("the commit has the message", (await git.log(null, 1, 0))[0]?.subject === "From Waymark");
}

async function runRefusal(ctx: SelfTestContext, mode: string, played: string[]): Promise<void> {
  const { reader, vault, panel, check, until, wait } = ctx;
  await panel.refresh();
  const head = panel.status?.head;
  await panel.sync();
  const kind = panel.state.kind === "error" ? panel.state.error.kind : panel.state.kind;
  const expected = mode === "diverged" ? "diverged" : "localChangesBlock";
  check(`sync refuses: ${expected}`, kind === expected, kind);
  const after = await git.status();
  check("HEAD unchanged", after.head === head, { before: head, after: after.head });
  const label = document.querySelector(".sync-label")?.textContent;
  check("titlebar explains the state", label === (mode === "diverged" ? "Diverged" : "Blocked"), label);
  panel.open();
  await wait(400);
  const name = document.querySelector(".sync-head .sync-remote-name")?.getBoundingClientRect();
  const closeButton = document.querySelector(".sync-head .icon-btn")?.getBoundingClientRect();
  const offset =
    name && closeButton ? Math.abs(name.top + name.height / 2 - (closeButton.top + closeButton.height / 2)) : Number.NaN;
  check("the sync panel opens on the repository, level with its close button", offset <= 2, offset);
  const notice = document.querySelector(".sync-sheet .notice strong")?.textContent;
  check("sync panel explains the problem", !!notice, notice);
  check(
    "panel offers the external route",
    !!document.querySelector(".sync-sheet .notice-actions .btn"),
    document.querySelector(".sync-sheet .notice-actions .btn")?.textContent,
  );
  if (mode === "blocked") {
    reader.inspector.setPane("info");
    await until(() => !!document.querySelector(".rail-history .rail-commit"), 4000);
    check(
      "the Info pane flags uncommitted edits",
      document.querySelector(".rail-history .rail-commit-subject")?.textContent === "Uncommitted changes",
    );
    reader.inspector.setPane("links");
  }
  if (mode === "blocked") check("local edit preserved", (vault.texts.get("Welcome.md") ?? "").includes("my local edit"));
  check("a refused sync plays the problem cue once", played.filter((c) => c === "problem").length === 1, played);
  await panel.commitAndSync("should not land");
  check("commit and sync stops before committing", (await git.status()).head === head);
}

/**
 * Checks that run inside the packaged app (WKWebView + Rust), started with
 * WAYMARK_SELFTEST_OUT. "read" exercises a real vault without writing to it;
 * "git" drives sync against a disposable fixture repository.
 */
export async function runSelfTest(app: App, mode: string, log: (line: string) => void): Promise<Record<string, unknown>> {
  const reader = app.reader;
  if (!reader) throw new Error("The self-test needs an open vault");
  const { vault, sync } = reader;
  const panel = sync.panel;
  const results: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    results.push({ name, ok, detail });
    log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail ?? "")}`);
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn: () => boolean, ms = 8000) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (fn()) return true;
      await wait(50);
    }
    return false;
  };
  const report: Record<string, unknown> = { mode, userAgent: navigator.userAgent, startup: { ...app.metrics } };
  const ctx: SelfTestContext = { app, reader, vault, panel, check, wait, until, log, report };

  if (mode === "empty") {
    await runEmpty(ctx);
    report.results = results;
    report.passed = results.every((r) => r.ok);
    return report;
  }

  await until(() => app.metrics.indexMs > 0, 20000);
  report.startup = { ...app.metrics };
  check("vault indexed", vault.index.notes.length > 0, vault.index.notes.length);

  if (mode.startsWith("show:")) await runShow(ctx, mode);
  if (mode === "read") await runRead(ctx);

  const played: string[] = [];
  app.sound.onPlay = (cue: string) => played.push(cue);

  if (mode === "git") await runGit(ctx, played);
  if (mode === "commit") await runCommit(ctx);
  if (mode === "diverged" || mode === "blocked") await runRefusal(ctx, mode, played);
  if (mode === "restore") await runRestore(ctx);
  if (mode === "conflict") await runConflict(ctx);
  if (mode === "backup") await runBackup(ctx);
  if (mode === "library") await runLibrary(ctx);
  if (mode === "organize") await runOrganize(ctx);
  if (mode.startsWith("relaunch")) await runRelaunch(ctx, mode);

  report.results = results;
  report.passed = results.every((r) => r.ok);
  return report;
}
