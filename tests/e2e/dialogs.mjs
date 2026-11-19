// Confirmations: nothing destructive is armed when a dialog opens, and every path out of one is visible. Layers: modal
// ones shut the page behind them, every one gives focus back, and menus, choosers and settings answer the keys.
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pause = (ms) => page.waitForTimeout(ms);
const exists = (name) => page.locator(`.nav-item[data-path="${name}"]`).count();
const ring = (locator) =>
  locator.evaluate((el) => ({
    style: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
    focus: el.matches(":focus-visible"),
  }));

const appInert = () => page.evaluate(() => document.querySelector("#app").inert);
const activePath = () => page.evaluate(() => document.activeElement?.dataset.path ?? document.activeElement?.tagName);
const focusRow = (name) => page.evaluate((n) => document.querySelector(`.nav-item[data-path="${n}"]`).focus(), name);

/* Every layer: modal ones shut the page behind them and give focus back; menus and choices answer the keys. */
async function layers() {
  await page.evaluate(async () => {
    const load = (file) => import(/* @vite-ignore */ `${location.origin}/src/ui/${file}`);
    window.parts = await load("git-panel-parts.ts");
    window.prompts = await load("prompts.ts");
    window.overlays = await load("overlays.ts");
    window.menus = await load("context-menu.ts");
    window.choices = await load("note-actions.ts");
  });

  /* The palette */
  await page.keyboard.press("Meta+k");
  await pause(80);
  check("the palette is a modal dialog", (await page.locator(".palette").getAttribute("aria-modal")) === "true");
  check("the page behind the palette is inert", await appInert());
  await page.keyboard.press("Tab");
  check("Tab stays in the palette field", await page.evaluate(() => document.activeElement.matches(".palette-field input")));
  await page.locator(".palette-field input").fill(">");
  await pause(80);
  const selectedIndex = () => page.evaluate(() => Number(document.querySelector(".palette-row.is-selected")?.dataset.index));
  const lastIndex = await page.evaluate(() => document.querySelectorAll(".palette-row").length - 1);
  await page.keyboard.press("End");
  check("End reaches the last result", (await selectedIndex()) === lastIndex, `${await selectedIndex()} of ${lastIndex}`);
  await page.keyboard.press("Home");
  check("Home reaches the first", (await selectedIndex()) === 0);
  await page.keyboard.press("PageDown");
  const paged = await selectedIndex();
  check("PageDown moves by a screen of results", paged > 3 && paged < lastIndex, String(paged));
  await page.keyboard.press("PageUp");
  check("PageUp comes back", (await selectedIndex()) === 0);
  check(
    "the field names the selected result",
    (await page.locator(".palette-field input").getAttribute("aria-activedescendant")) === "palette-opt-0",
  );
  await page.locator(".palette-field input").fill("zzzzqqqq");
  await pause(80);
  check(
    "with nothing matching, the field names no result",
    (await page.locator(".palette-field input").getAttribute("aria-activedescendant")) === null,
  );
  await page.keyboard.press("Escape");
  await pause(80);
  check("closing the palette frees the page", !(await appInert()));

  /* A sheet, and a confirmation over it */
  await focusRow("Linker.md");
  await page.evaluate(() =>
    window.parts.openSheet("History", "", Object.assign(document.createElement("div"), { textContent: "Before" })),
  );
  check("a sheet is a modal dialog", (await page.locator(".sheet").getAttribute("aria-modal")) === "true");
  check("the page behind a sheet is inert", await appInert());
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  check("Tab stays in the sheet", await page.evaluate(() => document.activeElement.closest(".sheet") !== null));
  await page.evaluate(() => {
    window.confirmed = window.prompts.confirmAction({ title: "Restore?", body: "Brings back this version.", action: "Restore" });
  });
  await pause(80);
  const nested = await page.evaluate(() => {
    const box = document.querySelector(".prompt");
    return {
      sheetInert: document.querySelector(".sheet-overlay").inert,
      description: document.getElementById(box.getAttribute("aria-describedby"))?.textContent,
    };
  });
  check("a confirmation over a sheet shuts the sheet too", nested.sheetInert, JSON.stringify(nested));
  check("the confirmation is described by its text", nested.description === "Brings back this version.");
  await page.keyboard.press("Escape");
  await pause(80);
  const after = await page.evaluate(() => ({
    sheetInert: document.querySelector(".sheet-overlay").inert,
    inSheet: document.activeElement.closest(".sheet") !== null,
  }));
  check("closing it opens the sheet again with focus back in it", !after.sheetInert && after.inSheet, JSON.stringify(after));
  check("while the page stays shut", await appInert());
  await page.keyboard.press("Escape");
  await pause(80);
  check("closing the sheet frees the page", !(await appInert()));
  check("and gives focus back to what opened it", (await activePath()) === "Linker.md", await activePath());

  /* The lightbox */
  await page.evaluate(() => window.overlays.lightbox(Object.assign(document.createElement("div"), { textContent: "Large" })));
  check("the page behind the lightbox is inert", await appInert());
  await page.keyboard.press("Escape");
  check("closing it frees the page and returns focus", !(await appInert()) && (await activePath()) === "Linker.md");

  /* Context menus */
  const row = page.locator('.nav-item[data-path="Linker.md"]');
  await row.click({ button: "right" });
  await pause(60);
  const opened = await page.evaluate(() => ({
    name: document.querySelector(".context-menu").getAttribute("aria-label"),
    first: document.activeElement === document.querySelector(".context-item:not(.is-blocked)"),
    ring: document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle,
  }));
  check("a menu opened with the pointer takes focus on its first item", opened.first, JSON.stringify(opened));
  check("without drawing a ring", opened.ring === false || opened.ring === "none", JSON.stringify(opened));
  check("a menu has a name", Boolean(opened.name), String(opened.name));
  await page.keyboard.press("Escape");
  check("Escape gives focus back", (await activePath()) === "Linker.md", await activePath());

  await focusRow("Linker.md");
  await page.evaluate(() => {
    const noop = () => {};
    window.menus.showContextMenu(
      300,
      300,
      ["Copy", "Paste", "Pin", "Plum", "Rename"].map((label) => ({ label, run: noop })),
      {
        label: "Test",
      },
    );
  });
  const focusedItem = () => page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press("p");
  const firstP = await focusedItem();
  await page.keyboard.press("p");
  const secondP = await focusedItem();
  check("a repeated letter cycles through its items", firstP === "Paste" && secondP === "Pin", `${firstP} ${secondP}`);
  await pause(600);
  await page.keyboard.type("pl", { delay: 40 });
  check("letters typed together spell a name", (await focusedItem()) === "Plum", await focusedItem());
  await pause(600);
  await page.keyboard.press("r");
  check("a pause starts a new search", (await focusedItem()) === "Rename", await focusedItem());
  await page.keyboard.press("Enter");
  await pause(60);
  check("choosing an item gives focus back too", (await activePath()) === "Linker.md", await activePath());

  /* Inline rename */
  await row.click({ button: "right" });
  await pause(60);
  await page.keyboard.type("ren", { delay: 30 });
  await page.keyboard.press("Enter");
  await page.waitForSelector(".tree-name-input");
  await page.keyboard.press("Escape");
  await pause(60);
  check("cancelling a rename focuses the row again", (await activePath()) === "Linker.md", await activePath());

  /* The ambiguous-link chooser */
  await focusRow("Linker.md");
  await page.evaluate(() => {
    const anchor = document.activeElement;
    window.picked = null;
    window.choices.chooseAmbiguous(anchor, ["a/Same.md", "b/Same.md", "c/Same.md"], { title: () => "Same" }, (p) => {
      window.picked = p;
    });
  });
  const chooser = await page.evaluate(() => {
    const pop = document.querySelector(".popover.choose");
    return {
      role: pop.getAttribute("role"),
      name: document.getElementById(pop.getAttribute("aria-labelledby"))?.textContent,
      first: document.activeElement === pop.querySelector(".choose-row"),
    };
  });
  check("the chooser is a named menu", chooser.role === "menu" && /3 notes share/.test(chooser.name), JSON.stringify(chooser));
  check("it opens on its first choice", chooser.first);
  const chosenDir = () => page.evaluate(() => document.activeElement.querySelector(".choose-dir")?.textContent);
  await page.keyboard.press("ArrowDown");
  check("Down moves to the next choice", (await chosenDir()) === "b", await chosenDir());
  await page.keyboard.press("End");
  check("End reaches the last", (await chosenDir()) === "c");
  await page.keyboard.press("Home");
  check("Home reaches the first", (await chosenDir()) === "a");
  await page.keyboard.press("Escape");
  check(
    "Escape closes it and gives focus back",
    (await page.locator(".popover.choose").count()) === 0 && (await activePath()) === "Linker.md",
  );

  /* Settings */
  await focusRow("Linker.md");
  await page.keyboard.press("Meta+,");
  await pause(60);
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll('.popover.settings [role="radiogroup"]')].map((g) => ({
      name: g.getAttribute("aria-label") ?? document.getElementById(g.getAttribute("aria-labelledby"))?.textContent,
      stops: [...g.querySelectorAll('[role="radio"]')].filter((r) => r.tabIndex === 0).length,
      checked: g.querySelectorAll('[aria-checked="true"]').length,
    })),
  );
  check(
    "each settings choice is a named group with one checked option and one Tab stop",
    groups.length === 4 && groups.every((g) => g.name && g.stops === 1 && g.checked === 1),
    JSON.stringify(groups),
  );
  const volume = '.popover.settings [data-keyvolume][aria-checked="true"]';
  await page.locator('.popover.settings [data-keysound][aria-checked="true"]').focus();
  const soundBefore = await page.evaluate(() => document.activeElement.dataset.keysound);
  await page.keyboard.press("ArrowRight");
  const soundAfter = await page.evaluate(() => ({
    value: document.activeElement.dataset.keysound,
    checked: document.activeElement.getAttribute("aria-checked"),
    stop: document.activeElement.tabIndex,
  }));
  check(
    "an arrow moves to the next choice and chooses it",
    soundAfter.value !== soundBefore && soundAfter.checked === "true" && soundAfter.stop === 0,
    `${soundBefore} ${JSON.stringify(soundAfter)}`,
  );
  await page.keyboard.press("Home");
  check(
    "Home chooses the first, and the volume is unavailable with sounds off",
    (await page.evaluate(() => document.activeElement.dataset.keysound)) === "off" &&
      (await page.locator(".key-volume").getAttribute("aria-disabled")) === "true",
  );
  await page.locator(volume).focus();
  const volumeBefore = await page.evaluate(() => document.activeElement.dataset.keyvolume);
  await page.keyboard.press("ArrowRight");
  check(
    "an unavailable group ignores the arrows",
    (await page.evaluate(() => document.activeElement.dataset.keyvolume)) === volumeBefore,
  );
  await page.locator(`.popover.settings [data-keysound="${soundBefore}"]`).click();
  await page.keyboard.press("Escape");
  await pause(60);
  check(
    "Escape closes settings and gives focus to the button that opens them",
    await page.evaluate(() => document.activeElement.matches('[data-act="settings"]')),
  );
}

async function openDialog() {
  await page.locator('.nav-item[data-path="Doomed.md"]').click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Move to Trash")').click();
  await page.waitForSelector(".prompt");
  await pause(80);
}

try {
  await writeFile(path.join(app.vault, "Doomed.md"), "Soon gone.\n");
  await writeFile(path.join(app.vault, "Linker.md"), "See [[Doomed]].\n");
  await page.goto(`${app.url}?note=Linker`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);

  await openDialog();
  const danger = page.locator(".prompt .btn-danger");
  const cancel = page.locator('.prompt button:has-text("Cancel")');
  const opened = await page.evaluate(() => document.activeElement.className);
  check("the dialog itself takes focus on open", opened.includes("prompt"), opened);
  const armed = await ring(danger);
  check("the destructive button shows no ring on open", !armed.focus && armed.style === "none", JSON.stringify(armed));
  const heights = await page.evaluate(() => [...document.querySelectorAll(".prompt .btn")].map((b) => b.getBoundingClientRect()));
  check("both buttons are the same height", heights[0].height === heights[1].height, heights.map((h) => h.height).join());
  check("widths follow their labels", heights[0].width !== heights[1].width);
  const edges = await page.evaluate(() =>
    [...document.querySelectorAll(".prompt .btn")].map((b) => getComputedStyle(b).boxShadow),
  );
  check(
    "both buttons carry the same edge geometry",
    edges.every((e) => /1px/.test(e)),
    edges.join(" / "),
  );

  await page.keyboard.press("Enter");
  await pause(150);
  check("Return does not delete", (await exists("Doomed.md")) === 1 && (await page.locator(".prompt").count()) === 1);
  const afterEnter = await ring(cancel);
  check("Return moves to Cancel, so the key visibly did something", afterEnter.focus, JSON.stringify(afterEnter));
  await page.keyboard.press("Tab");
  await pause(40);
  const tabbed = await ring(danger);
  check(
    "the ring shows on the destructive button when reached by keyboard",
    tabbed.focus && tabbed.style !== "none" && tabbed.width === "2px",
    JSON.stringify(tabbed),
  );
  await page.keyboard.press("Tab");
  check("Tab stays inside the dialog", (await page.evaluate(() => document.activeElement.textContent)) === "Cancel");
  await page.keyboard.press("Escape");
  check("Escape cancels at once", (await page.locator(".prompt").count()) === 0 && (await exists("Doomed.md")) === 1);

  await openDialog();
  await cancel.click();
  check("cancelling with the pointer fades the dialog out", (await page.locator(".prompt-overlay.is-leaving").count()) === 1);
  await pause(200);
  check("the fade removes it", (await page.locator(".prompt").count()) === 0 && (await exists("Doomed.md")) === 1);

  await openDialog();
  await danger.hover();
  await pause(60);
  await page.mouse.down();
  await pause(60);
  const pressed = await danger.evaluate((el) => getComputedStyle(el).scale);
  await page.mouse.up();
  check("the destructive button responds to a press", pressed !== "none", pressed);
  await pause(350);
  check("the delete goes through when the button is pressed", (await exists("Doomed.md")) === 0);

  await page.evaluate(async () => {
    const { confirmAction } = await import(/* @vite-ignore */ `${location.origin}/src/ui/prompts.ts`);
    window.answer = confirmAction({ title: "Keep your text?", body: "Saves a copy.", action: "Save a copy" });
  });
  await pause(80);
  await page.keyboard.press("Enter");
  await pause(80);
  check("a non-destructive confirm keeps Return", (await page.evaluate(() => window.answer)) === true);
  await page.evaluate(() => {
    for (const overlay of document.querySelectorAll(".prompt-overlay")) overlay.remove();
  });

  /* The palette sizes to its results up to a maximum, and its field never moves. */
  const paletteBox = () =>
    page.evaluate(() => {
      const box = document.querySelector(".palette").getBoundingClientRect();
      const field = document.querySelector(".palette-field").getBoundingClientRect();
      const list = document.querySelector(".palette-list");
      return { height: box.height, fieldTop: field.top, overflows: list.scrollHeight > list.clientHeight };
    });
  await page.keyboard.press("Meta+k");
  await pause(80);
  const recent = await paletteBox();
  await page.keyboard.type("zzzzqqqq");
  await pause(80);
  const none = await paletteBox();
  check("no result leaves a short palette", none.height < 200, String(none.height));
  check("the field stays put when the results shrink", none.fieldTop === recent.fieldTop, `${recent.fieldTop} ${none.fieldTop}`);
  check(
    "the palette does not animate its height",
    await page.locator(".palette").evaluate((p) => {
      const { transitionProperty, transitionDuration } = getComputedStyle(p);
      return transitionDuration === "0s" || !/height|all/.test(transitionProperty);
    }),
  );
  await page.locator(".palette-field input").fill(`${"long ".repeat(400)}`);
  await pause(80);
  const wordy = await paletteBox();
  check("a very long query stays within the maximum", wordy.height <= 460, String(wordy.height));
  await page.locator(".palette-field input").fill(">");
  await pause(80);
  const many = await paletteBox();
  const fieldHeight = await page.locator(".palette-field").evaluate((f) => f.getBoundingClientRect().height);
  check("a long list does not squash the field", fieldHeight === 52, String(fieldHeight));
  check("many results stop at the maximum and scroll", many.height === 460 && many.overflows, JSON.stringify(many));
  check("the field stays put at the maximum", many.fieldTop === recent.fieldTop);
  await page.keyboard.press("Escape");
  await pause(80);

  /* The text prompt is a modal dialog: Tab stays inside it and focus goes back afterwards. */
  const askName = () =>
    page.evaluate(async () => {
      const { promptText } = await import(/* @vite-ignore */ `${location.origin}/src/ui/prompts.ts`);
      const opener = document.querySelector('.nav-item[data-path="Linker.md"]');
      opener.focus();
      window.answer = "unanswered";
      void promptText({
        title: "Name this",
        value: "Draft",
        action: "OK",
        validate: (v) => (v ? null : "A name is needed"),
      }).then((v) => {
        window.answer = v;
      });
    });
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a.tagName === "INPUT" ? "input" : a.textContent.trim() || a.tagName;
    });
  await askName();
  await pause(80);
  const dialog = page.locator(".prompt");
  check(
    "the prompt is a modal dialog",
    (await dialog.getAttribute("role")) === "dialog" && (await dialog.getAttribute("aria-modal")) === "true",
  );
  check("the prompt has a name", (await dialog.getAttribute("aria-label")) === "Name this");
  check("the prompt opens on its field", (await focused()) === "input");
  const walk = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    walk.push(await focused());
  }
  check("Tab walks the prompt and wraps", walk.join() === "Cancel,OK,input", walk.join());
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab wraps backwards", (await focused()) === "OK", await focused());
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await pause(150);
  check("Escape cancels from a button too", (await page.evaluate(() => window.answer)) === null);
  check(
    "cancelling returns focus to what opened it",
    (await page.evaluate(() => document.activeElement.dataset.path)) === "Linker.md",
  );
  await askName();
  await pause(80);
  await page.locator(".prompt input").fill("");
  await page.keyboard.press("Enter");
  await pause(80);
  check("a refused value keeps the dialog open", (await page.locator(".prompt-note.is-problem").count()) === 1);
  await page.locator(".prompt-title").click();
  await page.keyboard.press("Tab");
  check("Tab still lands inside after a click on plain text", (await focused()) === "input", await focused());
  await page.locator(".prompt input").fill("Fine");
  await page.keyboard.press("Enter");
  await pause(150);
  check("an accepted value resolves", (await page.evaluate(() => window.answer)) === "Fine");
  check(
    "accepting returns focus to what opened it",
    (await page.evaluate(() => document.activeElement.dataset.path)) === "Linker.md",
  );

  await layers();
} catch (e) {
  check("the run finished", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  await rm(path.join(app.vault, "Linker.md"), { force: true });
  await app.close();
}
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
