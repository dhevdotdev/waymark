import { type Commit, git, native } from "./platform";
import type { App } from "./ui/app";

type Reader = NonNullable<App["reader"]>;

export interface SelfTestContext {
  app: App;
  reader: Reader;
  vault: Reader["vault"];
  panel: Reader["sync"]["panel"];
  check: (name: string, ok: boolean, detail?: unknown) => void;
  wait: (ms: number) => Promise<unknown>;
  until: (fn: () => boolean, ms?: number) => Promise<boolean>;
  log: (line: string) => void;
  report: Record<string, unknown>;
}

const noteBody = (word: string) => `# Selftest note\n\nThe ${word} text.\n`;

async function clickRestore(
  panel: SelfTestContext["panel"],
  commit: Commit,
  note: string,
  until: SelfTestContext["until"],
): Promise<void> {
  await panel.detail.showCommit(commit, note);
  await until(() => document.querySelector(".sheet") !== null);
  [...document.querySelectorAll<HTMLElement>(".sheet button")].find((b) => b.textContent === "Restore this version")?.click();
}

/** Puts past versions back through the real sheet, against a real repository. */
export async function runRestore({ app, reader, vault, panel, check, until, wait }: SelfTestContext): Promise<void> {
  const note = "Selftest note.md";
  await app.open(note);
  await panel.refresh();
  const commits = await git.log(note, 10, 0);
  check("the note has two versions", commits.length === 2, commits.length);
  const head = (await git.status()).head;

  await clickRestore(panel, commits[1], note, until);
  await until(() => vault.texts.get(note) === noteBody("first"));
  check("the old text is on disk", (await vault.source.readText(note)) === noteBody("first"));
  await wait(300);
  check("Read shows the old text", document.querySelector(".doc")?.textContent?.includes("The first text") ?? false);
  let status = await git.status();
  check(
    "it is an ordinary unstaged change",
    status.files.some((f) => f.path === note && f.unstaged === "M"),
    status.files,
  );
  check("HEAD did not move", status.head === head, status.head);
  check("no commit was added", (await git.log(note, 10, 0)).length === 2);

  await clickRestore(panel, commits[0], note, until);
  await until(() => [...document.querySelectorAll(".prompt button")].some((b) => b.textContent === "Save a copy and restore"));
  check("uncommitted work asks before it is replaced", document.querySelector(".prompt") !== null);
  [...document.querySelectorAll<HTMLElement>(".prompt button")].find((b) => b.textContent === "Save a copy and restore")?.click();
  await until(() => vault.texts.get(note) === noteBody("second"));
  const files = await vault.source.list();
  const copy = files.find((f) => f.startsWith("Selftest note (before restore"));
  check(
    "the uncommitted text was kept as a copy",
    copy !== undefined && (await vault.source.readText(copy)) === noteBody("first"),
    copy,
  );
  check("the newer version is back", (await vault.source.readText(note)) === noteBody("second"));

  await reader.editing.open();
  await until(() => document.querySelector(".cm-content") !== null);
  status = await git.status();
  await clickRestore(panel, commits[1], note, until);
  if (status.files.some((f) => f.path === note)) {
    await until(() => document.querySelector(".prompt") !== null, 1500);
    [...document.querySelectorAll<HTMLElement>(".prompt button")]
      .find((b) => b.textContent === "Save a copy and restore")
      ?.click();
  }
  await until(() => document.querySelector(".cm-content")?.textContent?.includes("The first text") ?? false);
  check(
    "an open editor follows the restore",
    document.querySelector(".cm-content")?.textContent?.includes("The first text") ?? false,
  );
  await reader.editing.finish();
}

/** Both sides of a real conflict, read-only, then each way out of it. */
export async function runConflict({ app, reader, vault, check, until, wait }: SelfTestContext): Promise<void> {
  const note = "Selftest conflict.md";
  const conflict = async (other: string) => {
    await reader.editing.open();
    await until(() => document.querySelector(".cm-content") !== null);
    const before = await vault.source.readText(note);
    await vault.source.writeNote(note, other, before);
    document.querySelector<HTMLElement>(".cm-content")?.focus();
    document.execCommand("insertText", false, "typed here ");
    return until(() => document.querySelector<HTMLElement>(".edit-state")?.dataset.state === "conflict");
  };
  const press = (scope: string, label: string) =>
    [...document.querySelectorAll<HTMLElement>(`${scope} button`)].find((b) => b.textContent === label)?.click();
  await vault.save(note, "base text\n", null);
  await until(() => vault.index.notes.includes(note));
  await app.open(note);
  check("a conflict appears", await conflict("the other machine\n"));
  press(".edit-banner", "Compare");
  await until(() => document.querySelector(".sheet .diff-line") !== null);
  const lines = [...document.querySelectorAll(".sheet .diff-line")].map((l) => l.textContent ?? "");
  check(
    "the comparison shows both sides",
    lines.some((l) => l.includes("the other machine")) && lines.some((l) => l.includes("typed here")),
    lines,
  );
  press(".sheet", "Use other version");
  await until(() => document.querySelector<HTMLElement>(".edit-state")?.dataset.state === "saved");
  check("using the other version keeps the file", (await vault.source.readText(note)) === "the other machine\n");
  check("the editor shows it", document.querySelector(".cm-content")?.textContent?.includes("the other machine") ?? false);
  await reader.editing.finish();

  check("a second conflict appears", await conflict("a third version\n"));
  press(".edit-banner", "Keep mine");
  await wait(800);
  check("keep mine writes the editor's text", (await vault.source.readText(note)).includes("typed here"));
  await reader.editing.finish();
}

/** Scrolls a long note and leaves the position for the next launch to find. */
export async function runRelaunch({ app, reader, check, until, wait, report }: SelfTestContext, launch: string): Promise<void> {
  const note = "Selftest long.md";
  const scroller = document.querySelector<HTMLElement>(".scroller")!;
  const topLine = () => {
    const edge = scroller.getBoundingClientRect().top;
    return Number(
      [...document.querySelectorAll<HTMLElement>(".doc [data-line]")].find((b) => b.getBoundingClientRect().bottom > edge)
        ?.dataset.line,
    );
  };
  const saved = () =>
    (app as unknown as { prefs: { value: { vaults: Record<string, { spots?: Record<string, { line: number }> }> } } }).prefs
      .value;
  if (launch === "relaunch-1") {
    await app.open(note);
    await until(() => document.querySelector(".doc [data-line]") !== null);
    scroller.scrollTop = 2400;
    await wait(600);
    reader.spots.record();
    reader.persist();
    await (app as unknown as { prefs: { flush(): Promise<void> } }).prefs.flush();
    report.line = topLine();
    check(
      "the position was recorded",
      Object.values(saved().vaults).some((v) => v.spots?.[note]),
      saved().vaults,
    );
    return;
  }
  const spot = Object.values(saved().vaults).find((v) => v.spots?.[note])?.spots?.[note];
  check("the position survived the relaunch", spot !== undefined, saved().vaults);
  await until(() => document.querySelector(".doc [data-line]") !== null);
  await wait(400);
  check("the restored tab is at that place", topLine() === spot?.line, [topLine(), spot?.line]);
  await app.open("Welcome.md");
  await wait(400);
  await app.open(note);
  await wait(500);
  check("reopening returns to that place", topLine() === spot?.line, [topLine(), spot?.line]);
}

/** Backup against a real bare remote: nothing while off, then a real run with typing still pending. */
export async function runBackup({ app, reader, vault, panel, check, until, wait }: SelfTestContext): Promise<void> {
  const prefs = (app as unknown as { prefs: { value: { backupMinutes: number } } }).prefs;
  const backup = reader.sync.backup;
  await panel.refresh();
  const head = (await git.status()).head;
  await vault.save("Selftest backup.md", "Waiting for a backup.\n", null);
  check("backup is off by default", prefs.value.backupMinutes === 0, prefs.value.backupMinutes);
  await backup.run();
  check("turned off, nothing is committed", (await git.status()).head === head);

  prefs.value.backupMinutes = 10;
  await until(() => vault.index.notes.includes("Selftest backup.md"), 2000);
  await app.open("Selftest backup.md");
  await reader.editing.open();
  await until(() => document.querySelector(".cm-content") !== null);
  document.querySelector<HTMLElement>(".cm-content")?.focus();
  document.execCommand("insertText", false, "typed just before the run ");
  const running = backup.run();
  document.execCommand("insertText", false, "and during it ");
  const second = backup.run();
  await Promise.all([running, second]);
  check("typing was not interrupted", document.querySelector(".cm-content")?.textContent?.includes("and during it") ?? false);
  await wait(800);
  const after = await git.status();
  check("the run reached the remote", after.ahead === 0 && after.behind === 0, after);
  check("the run is not an error", panel.state.kind === "idle", panel.state);
  await reader.editing.finish();
  await wait(300);
  await backup.run();
  const log = await git.log(null, 5, 0);
  check(
    "the message has the expected form",
    /^vault backup: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(log[0]?.subject ?? ""),
    log[0]?.subject,
  );
  panel.open();
  await until(() => document.querySelector(".sync-backup") !== null, 2000);
  check(
    "the panel says when it ran and that it arrived",
    document.querySelector(".sync-backup")?.textContent?.includes("on the remote") ?? false,
    document.querySelector(".sync-backup")?.textContent,
  );
  panel.close();
}

/** Excluded files, a view, bookmarks and paste in the real app, including what Rust reads from disk. */
export async function runLibrary({ app, reader, vault, check, until, wait }: SelfTestContext): Promise<void> {
  check("Obsidian's excluded list is read", (await vault.source.settings()).ignoreFilters.includes("Excluded.md"));
  check("an excluded note is hidden from the lists", !vault.index.notes.includes("Excluded.md"));
  check("and is not searchable", vault.search.search("uniquewordexcluded", 5).length === 0);
  check("but a link to it still resolves", vault.index.resolve("Excluded").kind === "found");

  await reader.open("Views/Items.base");
  await until(() => document.querySelector(".doc.is-base table") !== null);
  const cells = [...document.querySelectorAll(".doc.is-base tbody tr td:first-child")].map((c) => c.textContent);
  check("a view lists its matching notes", cells.join() === "Selftest item one", cells);
  const edited = document.querySelector(".doc.is-base tbody tr td:last-child")?.textContent ?? "";
  check("file times come from disk", /\d/.test(edited), edited);
  document.querySelector<HTMLElement>(".doc.is-base tbody tr")?.click();
  await until(() => reader.current === "Selftest item one.md");
  check("a row opens its note", reader.current === "Selftest item one.md", reader.current);

  const { bookmarks } = reader;
  bookmarks.toggle({ path: "Selftest item one.md" });
  check("a note can be bookmarked", bookmarks.has({ path: "Selftest item one.md" }));
  await reader.files.renameTo("Selftest item one.md", "Selftest item renamed");
  check("the bookmark follows a rename", bookmarks.has({ path: "Selftest item renamed.md" }));

  await reader.editing.open();
  await until(() => document.querySelector(".cm-content") !== null);
  const content = document.querySelector<HTMLElement>(".cm-content")!;
  content.focus();
  const data = new DataTransfer();
  data.setData("text/html", "<h2>Pasted heading</h2><p>With <strong>bold</strong>.</p>");
  data.setData("text/plain", "Pasted heading With bold.");
  content.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  await until(() => document.querySelector<HTMLElement>(".edit-state")?.dataset.state === "saved");
  await wait(600);
  const saved = await vault.source.readText("Selftest item renamed.md");
  check("pasted HTML is written as Markdown", saved.includes("## Pasted heading") && saved.includes("**bold**"), saved);
  check("the plain-paste clipboard call works", typeof (await native.clipboardText()) === "string");
  await reader.editing.finish();
  app.reader?.persist();
}
