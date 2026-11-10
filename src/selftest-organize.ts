import { native } from "./platform";
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
    distances.length === 4 && distances.every((d) => d >= 5.5),
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

export async function runOrganize(ctx: SelfTestContext): Promise<void> {
  await checkTable(ctx);
  await checkClipboard(ctx);
  await checkMove(ctx);
  checkPin(ctx);
  await checkDialog(ctx);
  checkWelcome(ctx);
}

export async function runEmpty({ check, until }: SelfTestContext): Promise<void> {
  check("an empty folder shows its page", await until(() => document.querySelector(".empty-state.is-page") !== null));
  check("it offers a new note", document.querySelector('[data-act="new-note"].btn') !== null);
  check("it offers another folder", document.querySelector('[data-act="open-vault"].btn') !== null);
  check("no stray divider shows", getComputedStyle(document.querySelector(".trail")!).display === "none");
}
