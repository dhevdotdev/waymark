// Renders design/icon.html to a 1024px PNG for `tauri icon`.
import { webkit } from "playwright";
const [src, out] = process.argv.slice(2);
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
await p.goto("file://" + src);
await p.locator("svg").screenshot({ path: out, omitBackground: true });
await b.close();
