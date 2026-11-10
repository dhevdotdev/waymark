import { git, native } from "./platform";
import type { SelfTestContext } from "./selftest-recovery";
import { confirmAction } from "./ui/prompts";
import { showWelcome } from "./ui/welcome";

const clearOf = (a: DOMRect, b: DOMRect) =>
  Math.hypot(
    Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)),
    Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)),
  );

async function checkTable({ reader, vault, check, until, wait }: SelfTestContext): Promise<void> {
  await reader.open("Plot.md", { focus: true });
  await reader.editing.open({});
  check("a table draws in the real web view", await until(() => document.querySelector(".cm-table-widget table") !== null));
  const root = document.querySelector<HTMLElement>(".cm-table-widget")!;
  const original = await vault.source.readText("Plot.md");
  const cell = (row: number, column: number) => root.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`)!;
  cell(1, 0).dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: 11, clientY: 13 }));
  await wait(200);
  const table = root.querySelector("table")!.getBoundingClientRect();
  const distances = [...root.querySelectorAll<HTMLElement>(".cm-table-grip:not([hidden]), .cm-table-add")].map((el) =>
    clearOf(el.getBoundingClientRect(), table),
  );
  check(
    "every control clears the table in the real web view",
    distances.length === 5 && distances.every((d) => d >= 5.5),
    distances,
  );
  root.querySelector<HTMLElement>(".cm-table-add.is-row")!.click();
  await wait(150);
  check("a new row is marked as it arrives", document.querySelectorAll(".cm-table-widget .is-marked").length > 0);
  check(
    "the cursor lands in the new row",
    document.activeElement?.getAttribute("data-row") === "4",
    document.activeElement?.getAttribute("data-row"),
  );
  await reader.editing.flush();
  const grown = await vault.source.readText("Plot.md");
  check("the row is in the file", grown.split("\n").length === original.split("\n").length + 1);
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }),
  );
  await wait(150);
  await reader.editing.flush();
  check("undo returns the exact file", (await vault.source.readText("Plot.md")) === original);
  check("focus stays in a cell after undo", document.activeElement?.hasAttribute("data-row") === true);
  cell(1, 0).focus();
  await wait(100);
  check(
    "the palette offers Delete table in a cell",
    reader.commands.listed().some((c) => c.id === "delete-table"),
  );
  reader.commands.run("delete-table", "palette");
  await wait(150);
  await reader.editing.flush();
  check("Delete table removes only the table", !(await vault.source.readText("Plot.md")).includes("| Bed |"));
  document
    .querySelector(".cm-content")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
  await wait(150);
  await reader.editing.flush();
  check("one undo restores the exact file after Delete table", (await vault.source.readText("Plot.md")) === original);
  await reader.editing.close?.();
}

async function checkClipboard({ check }: SelfTestContext): Promise<void> {
  const before = await native.clipboardText();
  await native.copyText("[[Selftest#Heading]]");
  check("copying a link reaches the system clipboard", (await native.clipboardText()) === "[[Selftest#Heading]]");
  await native.copyText(before);
}

async function checkMove({ reader, vault, check, until }: SelfTestContext): Promise<void> {
  const moved = await reader.files.moveToFolder("Inbox/Alpha.md", "Archive");
  check("a note moves between folders on disk", moved && (await until(() => vault.index.notes.includes("Archive/Alpha.md"))));
  check("links to it are rewritten", (await vault.source.readText("Refs.md")).includes("[[Archive/Alpha]]"));
  const clash = await reader.files.moveToFolder("Inbox/Dup.md", "Archive");
  check("a same-named note is not overwritten", !clash && (await vault.source.readText("Archive/Dup.md")) === "Archive copy.\n");
  const stats = await vault.source.fileStats(["Refs.md"]);
  check("file times are available for sorting", Number.isFinite(stats["Refs.md"]?.mtime));
}

function checkPin({ reader, check }: SelfTestContext): void {
  const { workspace } = reader;
  workspace.togglePin(0);
  check("a pinned tab is saved", (workspace.save().pinned ?? []).length === 1, workspace.save().pinned);
  workspace.togglePin(0);
}

async function checkDialog({ check, wait }: SelfTestContext): Promise<void> {
  const answer = confirmAction({ title: "Remove?", body: "Selftest.", action: "Delete", danger: true });
  await wait(60);
  const box = document.querySelector<HTMLElement>(".prompt")!;
  check("a destructive dialog holds focus itself", document.activeElement === box);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await wait(60);
  check("Return does not confirm a destructive dialog", document.activeElement?.textContent === "Cancel");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  check("Escape cancels it", (await answer) === false);
}

function checkWelcome({ check }: SelfTestContext): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;visibility:hidden;inset:0";
  document.body.append(host);
  showWelcome(host, ["/Users/you/Field notes"], () => {});
  check("the welcome page names the app", host.querySelector("h1")?.textContent === "Waymark");
  check("it offers both ways in", host.querySelectorAll(".welcome-actions .btn").length === 2);
  host.remove();
}

/** A real property change through the panel, in the packaged app, read back from the file. */
async function checkProperties({ app, reader, vault, check, until, wait }: SelfTestContext): Promise<void> {
  const note = "Refs.md";
  const before = await vault.read(note);
  await app.open(note);
  reader.inspector.setPane("info");
  await until(() => document.querySelector(".prop-add") !== null);
  document.querySelector<HTMLElement>(".prop-add")?.click();
  await wait(100);
  const [name, value] = document.querySelectorAll<HTMLInputElement>(".prop-new-field");
  name.value = "Due date";
  value.value = "soon: maybe";
  value.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await until(() => document.querySelector('.prop-cell[data-key="Due date"]') !== null);
  check(
    "adding a property writes the block at the top",
    (await vault.reread(note)) === `---\nDue date: "soon: maybe"\n---\n${before}`,
  );
  document.querySelector<HTMLElement>('.prop-cell[data-key="Due date"] .prop-remove')?.click();
  await until(() => document.querySelector('.prop-cell[data-key="Due date"]') === null);
  check("removing it leaves the note as it was", (await vault.reread(note)) === before);
  reader.inspector.setPane("links");
}

async function checkTrashUndo({ vault, check }: SelfTestContext): Promise<void> {
  const before = await vault.source.readText("Refs.md");
  const status = JSON.stringify(await git.status());
  const token = await vault.source.trashNote("Refs.md");
  check("a trashed note leaves the vault", !(await vault.source.list()).includes("Refs.md"));
  await vault.source.untrash(token);
  check("Undo restores a trashed note byte for byte", (await vault.source.readText("Refs.md")) === before);
  check("Undo leaves Git status as it was", JSON.stringify(await git.status()) === status);
  const refused = await vault.source.untrash(token).then(
    () => false,
    () => true,
  );
  check("a used Undo cannot run twice", refused);
}

async function checkMenu({ reader, check, wait }: SelfTestContext): Promise<void> {
  const items = await native.menuItems();
  check("the menu bar is populated", items.length > 20, items.length);
  const chord = (keys: string) => keys.replace("CmdOrCtrl", "mod").toLowerCase();
  const mismatched = items.filter(({ id, keys }) => keys !== null && !reader.commands.keysOf(id).includes(chord(keys)));
  check(
    "every menu shortcut matches its command",
    mismatched.length === 0,
    mismatched.map((m) => m.id),
  );
  await wait(200);
  const enabled = async (id: string) => (await native.menuItems()).find((m) => m.id === id)?.enabled;
  check("Reopen Closed Tab starts greyed out", (await enabled("reopen-tab")) === false);
  await reader.open("Refs.md", { newTab: true, focus: true });
  await wait(300);
  reader.closeTab(reader.workspace.activeIndex);
  await wait(300);
  check("it lights up once a tab has closed", (await enabled("reopen-tab")) === true);
  reader.commands.run("reopen-tab", "click");
  await wait(300);
  reader.closeTab(reader.workspace.activeIndex);
  await wait(200);
}

export async function runOrganize(ctx: SelfTestContext): Promise<void> {
  await checkMenu(ctx);
  await checkTrashUndo(ctx);
  await checkTable(ctx);
  await checkClipboard(ctx);
  await checkMove(ctx);
  checkPin(ctx);
  await checkProperties(ctx);
  await checkDialog(ctx);
  checkWelcome(ctx);
}

export async function runEmpty({ check, until }: SelfTestContext): Promise<void> {
  check("an empty folder shows its page", await until(() => document.querySelector(".empty-state.is-page") !== null));
  check("it offers a new note", document.querySelector('[data-act="new-note"].btn') !== null);
  check("it offers another folder", document.querySelector('[data-act="open-vault"].btn') !== null);
  check("the path row stays out of sight", getComputedStyle(document.querySelector(".pane-head")!).visibility === "hidden");
}
