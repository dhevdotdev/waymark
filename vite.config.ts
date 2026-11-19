import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".base": "text/plain; charset=utf-8",
};

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, child)));
    else out.push(child);
  }
  return out;
}

/**
 * Development stand-in for the Tauri vault commands, so the app can be built
 * and tested in a browser. Writes follow the same rule as the desktop build:
 * a note is replaced only if it still holds what the caller expected.
 */
async function writeNote(root: string, body: { path: string; text: string; expected: string | null }): Promise<object | null> {
  const abs = path.resolve(root, body.path);
  const inside = abs.startsWith(path.resolve(root) + path.sep) && !body.path.split("/").some((p) => p.startsWith("."));
  if (!inside || !body.path.toLowerCase().endsWith(".md")) return null;
  const current = await readFile(abs, "utf8").catch(() => null);
  if (current === null && body.expected !== null) return { kind: "missing" };
  if (current !== null && current !== body.expected) return { kind: "changed", current };
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = `${abs}.waymark-tmp`;
  await writeFile(temp, body.text);
  await rename(temp, abs);
  return { kind: "saved" };
}

const devTrash = new Map<number, { original: string; inTrash: string }>();
const FILE_ACTIONS = new Set(["/rename", "/trash", "/untrash", "/trash-folder", "/attachment", "/keep-in-trash"]);

function insideVault(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep) || rel.split("/").some((p) => p.startsWith(".")))
    throw new Error("outside the vault");
  return abs;
}

async function respondToFileAction(root: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.headers["x-waymark"] !== "1") throw new Error("refused");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  if (url.pathname === "/attachment") {
    const target = insideVault(root, url.searchParams.get("path") ?? "");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx" });
  } else if (url.pathname === "/keep-in-trash") {
    const { name, text } = JSON.parse(body.toString());
    if (path.basename(name) !== name || !name.endsWith(".md")) throw new Error("not a note name");
    await mkdir(path.join(root, ".dev-trash"), { recursive: true });
    await writeFile(path.join(root, ".dev-trash", name), text);
  } else if (url.pathname === "/trash" || url.pathname === "/trash-folder") {
    const original = insideVault(root, JSON.parse(body.toString()).path);
    const token = devTrash.size + 1;
    const parked = path.join(root, ".dev-trash", String(token));
    await mkdir(parked, { recursive: true });
    const inTrash = path.join(parked, path.basename(original));
    await rename(original, inTrash);
    devTrash.set(token, { original, inTrash });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ token }));
    return;
  } else if (url.pathname === "/untrash") {
    const entry = devTrash.get(JSON.parse(body.toString()).token);
    if (!entry) throw new Error("gone");
    await stat(entry.original).then(
      () => {
        throw new Error("exists");
      },
      () => undefined,
    );
    await mkdir(path.dirname(entry.original), { recursive: true });
    await rename(entry.inTrash, entry.original);
    devTrash.delete(JSON.parse(body.toString()).token);
  } else {
    const { from, to } = JSON.parse(body.toString());
    const target = insideVault(root, to);
    await stat(target).then(
      () => {
        throw new Error("exists");
      },
      () => undefined,
    );
    await mkdir(path.dirname(target), { recursive: true });
    await rename(insideVault(root, from), target);
  }
  res.end();
}

async function respondWithSettings(root: string, res: ServerResponse): Promise<void> {
  const app = await readFile(path.join(root, ".obsidian/app.json"), "utf8").then(JSON.parse, () => ({}));
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      attachmentFolder: app.attachmentFolderPath ?? "",
      newNoteLocation: app.newFileLocation ?? "",
      newNoteFolder: app.newFileFolderPath ?? "",
      ignoreFilters: Array.isArray(app.userIgnoreFilters) ? app.userIgnoreFilters : [],
      strictLineBreaks: app.strictLineBreaks === true,
    }),
  );
}

async function respondWithFile(root: string, rel: string, res: ServerResponse): Promise<void> {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep) || rel.split("/").some((p) => p.startsWith("."))) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const info = await stat(abs);
  if (!info.isFile()) throw new Error("not a file");
  res.setHeader("content-type", MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream");
  res.end(await readFile(abs));
}

async function respondToWrite(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* A custom header forces a CORS preflight, so another site open in a browser cannot post here. */
  if (req.headers["x-waymark"] !== "1") {
    res.statusCode = 403;
    res.end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const outcome = await writeNote(root, JSON.parse(raw));
  res.statusCode = outcome ? 200 : 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(outcome));
}

async function respondWithStats(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const entries = await Promise.all(
    (JSON.parse(raw) as string[]).map(async (rel) => {
      const info = await stat(path.join(root, rel)).catch(() => null);
      return info ? [rel, { mtime: info.mtimeMs, ctime: info.birthtimeMs, size: info.size }] : null;
    }),
  );
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(Object.fromEntries(entries.filter((e) => e !== null))));
}

function devVault(root: string | undefined): Plugin {
  return {
    name: "waymark-dev-vault",
    configureServer(server) {
      server.middlewares.use("/@vault", async (req, res) => {
        if (!root) {
          res.statusCode = 503;
          res.end("WAYMARK_VAULT is not set");
          return;
        }
        const url = new URL(req.url ?? "/", "http://local");
        try {
          if (url.pathname === "/index") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(await walk(root)));
            return;
          }
          if (url.pathname === "/settings") {
            await respondWithSettings(root, res);
            return;
          }
          if (FILE_ACTIONS.has(url.pathname) && req.method === "POST") {
            await respondToFileAction(root, url, req, res);
            return;
          }
          if (url.pathname === "/stats" && req.method === "POST") {
            await respondWithStats(root, req, res);
            return;
          }
          if (url.pathname === "/write" && req.method === "POST") {
            await respondToWrite(root, req, res);
            return;
          }
          if (url.pathname === "/file") {
            await respondWithFile(root, url.searchParams.get("path") ?? "", res);
            return;
          }
          res.statusCode = 404;
          res.end();
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

/**
 * markdown-it-texmath falls back to `require("katex")` when it is given no engine. Waymark always gives it one that
 * loads KaTeX on demand, so the fallback must not put KaTeX back into the startup code.
 */
function texmathWithoutKatex(): Plugin {
  const stub = "\0texmath-katex";
  return {
    name: "texmath-without-katex",
    enforce: "pre",
    resolveId: (id, importer) => (id === "katex" && importer?.includes("markdown-it-texmath") ? stub : null),
    load: (id) => (id === stub ? "export default {};" : null),
  };
}

export default defineConfig({
  plugins: [devVault(process.env.WAYMARK_VAULT), texmathWithoutKatex()],
  clearScreen: false,
  server: { port: 5178, strictPort: true },
  /* The quick capture window loads its own small page, so it is ready at once and never pulls in the reader. */
  build: { rollupOptions: { input: { index: "index.html", capture: "capture.html" } } },
});
