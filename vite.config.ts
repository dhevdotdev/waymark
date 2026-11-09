import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
  const temp = `${abs}.waymark-tmp`;
  await writeFile(temp, body.text);
  await rename(temp, abs);
  return { kind: "saved" };
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
          if (url.pathname === "/write" && req.method === "POST") {
            await respondToWrite(root, req, res);
            return;
          }
          if (url.pathname === "/file") {
            const rel = url.searchParams.get("path") ?? "";
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

export default defineConfig({
  plugins: [devVault(process.env.WAYMARK_VAULT)],
  clearScreen: false,
  server: { port: 5178, strictPort: true },
});
