import { describe, expect, it } from "vitest";
import type { VaultSource } from "../../src/vault/source";
import { VaultStore } from "../../src/vault/store";

function source(files: Record<string, string>) {
  const reads: string[] = [];
  const fake: VaultSource = {
    list: async () => Object.keys(files),
    readText: async (path) => {
      reads.push(path);
      if (!(path in files)) throw new Error("missing");
      return files[path];
    },
    readMany: async (paths) => paths.map((p) => files[p] ?? null),
    assetUrl: (path) => `asset:${path}`,
  };
  return { fake, files, reads };
}

describe("VaultStore", () => {
  it("reads a note from disk once", async () => {
    const { fake, reads } = source({ "a.md": "text" });
    const store = await VaultStore.open(fake);
    await store.read("a.md");
    await store.read("a.md");
    expect(reads).toEqual(["a.md"]);
  });

  it("indexes links and search after loading", async () => {
    const { fake } = source({ "a.md": "See [[b]]", "b.md": "Findable words" });
    const store = await VaultStore.open(fake);
    await store.loadAll();
    expect(store.links.backlinks("b.md")).toEqual(["a.md"]);
    expect(store.search.search("findable").map((h) => h.path)).toEqual(["b.md"]);
  });

  it("registers aliases from frontmatter", async () => {
    const { fake } = source({ "a.md": "---\naliases: [Other name]\n---\nbody" });
    const store = await VaultStore.open(fake);
    await store.loadAll();
    expect(store.index.resolve("Other name")).toEqual({ kind: "found", path: "a.md" });
  });

  it("applies an edit without rebuilding", async () => {
    const { fake, files } = source({ "a.md": "old", "b.md": "other" });
    const store = await VaultStore.open(fake);
    await store.loadAll();
    const index = store.index;
    files["a.md"] = "See [[b]]";
    expect(await store.applyChanges(["a.md"])).toEqual({ structural: false, changed: ["a.md"] });
    expect(store.index).toBe(index);
    expect(store.links.backlinks("b.md")).toEqual(["a.md"]);
  });

  it("rebuilds when a note is added and forgets a deleted one", async () => {
    const { fake, files } = source({ "a.md": "text", "gone.md": "[[a]]" });
    const store = await VaultStore.open(fake);
    await store.loadAll();
    delete files["gone.md"];
    files["new.md"] = "[[a]]";
    const change = await store.applyChanges(["gone.md", "new.md"]);
    expect(change.structural).toBe(true);
    expect(store.texts.has("gone.md")).toBe(false);
    expect(store.links.backlinks("a.md")).toEqual(["new.md"]);
  });

  it("describes the line that links to a note", async () => {
    const { fake } = source({ "a.md": "- Read **this** with [[b|the other one]] later", "b.md": "x" });
    const store = await VaultStore.open(fake);
    await store.loadAll();
    expect(store.linkContext("a.md", "b.md")).toBe("Read this with the other one later");
  });
});
