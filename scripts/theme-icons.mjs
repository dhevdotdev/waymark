// Recolours design/icon.html for each theme family and writes 512px Dock icons to src-tauri/icons/themes.
// Catppuccin is the artwork itself and ships as the app's own icon, so it needs no file here.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { webkit } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src-tauri/icons/themes");
const SOURCE = {
  tileTop: "#1e1e2e",
  tileBottom: "#11111b",
  ribbonTop: "#f5c2e7",
  accent: "#cba6f7",
  foldBottom: "#7a4fd0",
  foldTop: "#b48cf2",
};
const FAMILIES = {
  "rose-pine": {
    tileTop: "#232136",
    tileBottom: "#1a1828",
    ribbonTop: "#ea9a97",
    accent: "#c4a7e7",
    foldBottom: "#7b5bb5",
    foldTop: "#ab8bdc",
  },
  gruvbox: {
    tileTop: "#282828",
    tileBottom: "#171919",
    ribbonTop: "#8ec07c",
    accent: "#83a598",
    foldBottom: "#3f6b60",
    foldTop: "#6f9586",
  },
  everforest: {
    tileTop: "#2d353b",
    tileBottom: "#232a2e",
    ribbonTop: "#dbbc7f",
    accent: "#a7c080",
    foldBottom: "#5a7a3f",
    foldTop: "#8da667",
  },
  ember: {
    tileTop: "#1c1b1a",
    tileBottom: "#131211",
    ribbonTop: "#f4b860",
    accent: "#f0783c",
    foldBottom: "#a8410f",
    foldTop: "#e0652a",
  },
};

const art = readFileSync(path.join(ROOT, "design/icon.html"), "utf8");
mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 0.5 });
for (const [family, colours] of Object.entries(FAMILIES)) {
  let html = art;
  for (const [role, colour] of Object.entries(SOURCE)) html = html.replaceAll(colour, colours[role]);
  await page.setContent(html);
  await page.locator("svg").screenshot({ path: path.join(OUT, `${family}.png`), omitBackground: true });
}
await browser.close();
