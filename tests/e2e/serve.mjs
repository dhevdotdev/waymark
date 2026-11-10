// Serves the app against a fresh fixture vault and returns the page URL.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { writeFixtureVault } from "./fixture-vault.mjs";

export async function serveFixture({ empty = false } = {}) {
  const vault = await mkdtemp(path.join(tmpdir(), "waymark-fixture-"));
  if (!empty) await writeFixtureVault(vault);
  process.env.WAYMARK_VAULT = vault;
  const server = await createServer({ logLevel: "error", server: { port: 0, strictPort: false } });
  await server.listen();
  return {
    url: `http://localhost:${server.httpServer.address().port}/`,
    vault,
    async close() {
      await server.close();
      await rm(vault, { recursive: true, force: true });
    },
  };
}
