import { git } from "./platform";
import type { App } from "./ui/app";

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

  await until(() => app.metrics.indexMs > 0, 20000);
  report.startup = { ...app.metrics };
  check("vault indexed", vault.index.notes.length > 0, vault.index.notes.length);

  if (mode.startsWith("show:")) {
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

  if (mode === "read") {
    const sample = vault.index.attachments.find((p) => /\.png$/i.test(p));
    if (sample) {
      const url = vault.source.assetUrl(sample);
      const img = new Image();
      img.src = url;
      await until(() => img.complete, 4000);
      log(`asset img ${img.naturalWidth}x${img.naturalHeight}`);
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
    firstCommit?.click();
    await until(() => !!document.querySelector(".sheet-overlay"), 4000);
    check(
      "a history entry opens that commit's change",
      !!document.querySelector(".sheet-overlay .diff, .sheet-overlay .sheet-body *"),
    );
    check("a history entry offers the old version", !!document.querySelector(".sheet-actions .btn"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wait(250);
    reader.inspector.setPane("outline");
    reader.openGraph("vault");
    await wait(1500);
    check("graph opens", !!document.querySelector(".graph-view canvas"));
    reader.leaveGraph();
  }

  const played: string[] = [];
  app.sound.onPlay = (cue: string) => played.push(cue);

  if (mode === "git") {
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
  }

  if (mode === "diverged" || mode === "blocked") {
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
    const notice = document.querySelector(".git-drawer .notice strong")?.textContent;
    check("sync panel explains the problem", !!notice, notice);
    check(
      "panel offers the external route",
      !!document.querySelector(".git-drawer .notice-actions .btn"),
      document.querySelector(".git-drawer .notice-actions .btn")?.textContent,
    );
    if (mode === "blocked") {
      reader.inspector.setPane("info");
      await until(() => !!document.querySelector(".rail-history .rail-commit"), 4000);
      check(
        "the Info pane flags uncommitted edits",
        document.querySelector(".rail-history .rail-commit-subject")?.textContent === "Uncommitted changes",
      );
      reader.inspector.setPane("outline");
    }
    if (mode === "blocked") check("local edit preserved", (vault.texts.get("Welcome.md") ?? "").includes("my local edit"));
    check("a refused sync plays the problem cue once", played.filter((c) => c === "problem").length === 1, played);
  }

  report.results = results;
  report.passed = results.every((r) => r.ok);
  return report;
}
