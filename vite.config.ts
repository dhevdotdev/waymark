import { readdir, readFile, stat } from "node:fs/promises";
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
 * Development stand-in for the Tauri vault commands: serves a vault directory
 * read-only so the reading surface can be built against real notes in a browser.
 */
function devVault(root: string | undefined): Plugin {
  return {
    name: "folio-dev-vault",
    configureServer(server) {
      server.middlewares.use("/@vault", async (req, res) => {
        if (!root) {
          res.statusCode = 503;
          res.end("FOLIO_VAULT is not set");
          return;
        }
        const url = new URL(req.url ?? "/", "http://local");
        try {
          if (url.pathname === "/index") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(await walk(root)));
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
  plugins: [devVault(process.env.FOLIO_VAULT)],
  clearScreen: false,
  server: { port: 5178, strictPort: true },
});
