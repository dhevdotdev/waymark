import { describe, expect, it } from "vitest";
import { stripComments } from "../../src/render/comments";
import { detectCommunities } from "../../src/vault/communities";
import { parseFrontmatter } from "../../src/vault/frontmatter";
import { headingKey, VaultIndex } from "../../src/vault/index";
import { Trail, type View } from "../../src/vault/trail";
import { ancestors, buildTree } from "../../src/vault/tree";

const files = [
  "Notes/Tide and wind.md",
  "Notes/Config.md",
  "Inbox/Config.md",
  "Guides/Start here.md",
  "Attachments/diagram.png",
  "Attachments/book.pdf",
];

describe("VaultIndex.resolve", () => {
  const index = new VaultIndex(files);
  index.addAliases("Notes/Tide and wind.md", ["Sea conditions"]);

  it("matches a note by name, ignoring case", () => {
    expect(index.resolve("tide and wind")).toEqual({ kind: "found", path: "Notes/Tide and wind.md" });
  });
  it("reports a shared name as ambiguous instead of guessing", () => {
    expect(index.resolve("Config")).toEqual({ kind: "ambiguous", candidates: ["Inbox/Config.md", "Notes/Config.md"] });
  });
  it("uses a folder prefix to disambiguate", () => {
    expect(index.resolve("Inbox/Config")).toEqual({ kind: "found", path: "Inbox/Config.md" });
  });
  it("resolves aliases from frontmatter", () => {
    expect(index.resolve("Sea conditions")).toEqual({ kind: "found", path: "Notes/Tide and wind.md" });
  });
  it("reports missing targets", () => {
    expect(index.resolve("Nope")).toEqual({ kind: "missing" });
  });
  it("finds attachments by file name", () => {
    expect(index.resolve("diagram.png", false)).toEqual({ kind: "found", path: "Attachments/diagram.png" });
    expect(index.resolve("book.pdf", false)).toEqual({ kind: "found", path: "Attachments/book.pdf" });
  });
});

describe("headingKey", () => {
  it("matches Obsidian heading links regardless of punctuation and code marks", () => {
    expect(headingKey("Transactional - keeping the context open")).toBe(headingKey("transactional keeping the context open"));
    expect(headingKey("`@EntityGraph` usage")).toBe("entitygraph usage");
  });
});

describe("stripComments", () => {
  it("removes inline and block comments", () => {
    expect(stripComments("a %%hidden%% b")).toBe("a  b");
    expect(stripComments("x\n%%\nsecret\n%%\ny")).toBe("x\n\ny");
  });
  it("keeps %% inside code", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell parameter expansion is the input under test.
    const src = 'printf("%%d") `%%` and\n```bash\necho "${1%%/}"\n```\n';
    expect(stripComments(src)).toBe(src);
  });
});

describe("parseFrontmatter", () => {
  it("reads scalars and lists", () => {
    const { data, body } = parseFrontmatter("---\nstatus: unread\naliases:\n  - One\n  - Two\ntags: [a, b]\n---\n# Hi\n");
    expect(data).toEqual({ status: "unread", aliases: ["One", "Two"], tags: ["a", "b"] });
    expect(body).toBe("# Hi\n");
  });
  it("leaves notes without frontmatter alone", () => {
    expect(parseFrontmatter("plain").body).toBe("plain");
  });
});

describe("file tree", () => {
  const tree = buildTree(["z.md", "B/note 10.md", "B/note 2.md", "A/deep/x.md", "a.md"]);

  it("mirrors folders on disk, folders before notes, in natural order", () => {
    expect(tree.folders.map((f) => f.name)).toEqual(["A", "B"]);
    expect(tree.notes).toEqual(["a.md", "z.md"]);
    expect(tree.folders[1].notes).toEqual(["B/note 2.md", "B/note 10.md"]);
  });

  it("counts notes recursively", () => {
    expect(tree.count).toBe(5);
    expect(tree.folders[0].count).toBe(1);
  });

  it("lists the folders above a note", () => {
    expect(ancestors("A/deep/x.md")).toEqual(["A", "A/deep"]);
    expect(ancestors("a.md")).toEqual([]);
  });
});

describe("link communities", () => {
  const ring = (prefix: string): [string, string][] =>
    ["a", "b", "c", "d"].flatMap((x, i, all) =>
      all.slice(i + 1).map((y) => [`${prefix}${x}`, `${prefix}${y}`] as [string, string]),
    );
  const notes = [..."abcd"].flatMap((x) => [`p${x}`, `q${x}`]).concat("lonely");
  const edges = [...ring("p"), ...ring("q"), ["pa", "qa"] as [string, string]];

  it("separates groups that link mostly among themselves", () => {
    const { groupOf, communities } = detectCommunities(notes, edges);
    expect(communities).toHaveLength(2);
    expect(groupOf.get("pb")).toBe(groupOf.get("pd"));
    expect(groupOf.get("pb")).not.toBe(groupOf.get("qb"));
  });

  it("leaves unlinked notes unclustered", () => {
    expect(detectCommunities(notes, edges).groupOf.get("lonely")).toBe(-1);
  });

  it("gives the same answer whatever order the notes arrive in", () => {
    const a = detectCommunities(notes, edges).groupOf;
    const b = detectCommunities([...notes].reverse(), [...edges].reverse()).groupOf;
    for (const n of notes) expect(b.get(n)).toBe(a.get(n));
  });
});

describe("trail", () => {
  const note = (path: string): View => ({ kind: "note", path });
  const here = (t: Trail) => {
    const v = t.current.view;
    return v.kind === "note" ? v.path : "graph";
  };

  it("grows a branch when a second link is followed from the same note", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("c"));
    t.select(t.layout()[0].id);
    t.follow(note("d"));
    const rows = t.layout().map((p) => p.row);
    expect(rows).toEqual([0, 0, 0, 1]);
    expect(t.layout().at(-1)!.depth).toBe(1);
  });

  it("moves to a note already on the trail instead of repeating it", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("a"));
    expect(t.size).toBe(2);
    expect(here(t)).toBe("a");
  });

  it("records a link to a note already on the map as a cross link", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.back();
    t.follow(note("c"));
    t.follow(note("b"));
    expect(t.size).toBe(3);
    expect(t.crossLinks()).toHaveLength(1);
    expect(here(t)).toBe("b");
  });

  it("records a cycle back to an earlier note and does not repeat it", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("c"));
    t.follow(note("a"));
    t.follow(note("b"));
    expect(t.size).toBe(3);
    expect(t.crossLinks()).toHaveLength(1);
  });

  it("walks Back and Forward through the stops actually made, across cross links", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("c"));
    t.follow(note("a"));
    t.back();
    expect(here(t)).toBe("c");
    t.back();
    expect(here(t)).toBe("b");
    t.forward();
    t.forward();
    expect(here(t)).toBe("a");
  });

  it("keeps a note that is still linked from somewhere else when its branch is removed", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("c"));
    t.select(t.layout()[0].id);
    t.follow(note("d"));
    t.follow(note("c"));
    const b = t.layout()[1].id;
    t.remove(b);
    expect(t.size).toBe(3);
    expect(here(t)).toBe("c");
    expect(t.crossLinks()).toHaveLength(0);
  });

  it("restores cross links and stops, and rebuilds stops for trails saved without them", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("a"));
    const saved = JSON.parse(JSON.stringify(t.save())) as Record<string, unknown>;
    const restored = Trail.restore(saved, () => true)!;
    expect(restored.crossLinks()).toHaveLength(1);
    restored.back();
    expect(here(restored)).toBe("b");
    const older = Trail.restore(
      {
        nodes: [
          { id: 1, view: note("a"), parent: null, scroll: 0, lastChild: 2 },
          { id: 2, view: note("b"), parent: 1, scroll: 0, lastChild: null },
        ],
        root: 1,
        current: 2,
      },
      () => true,
    )!;
    expect(older.canBack).toBe(true);
    older.back();
    expect(here(older)).toBe("a");
  });

  it("goes back and forward between branches", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.back();
    t.follow(note("c"));
    t.back();
    t.forward();
    expect(here(t)).toBe("c");
  });

  it("starts a new trail on a jump and can return to the old one", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.jump(note("x"));
    expect(t.size).toBe(1);
    t.back();
    expect(here(t)).toBe("b");
    expect(t.size).toBe(2);
    t.forward();
    expect(here(t)).toBe("x");
  });

  it("removes a note with everything beyond it and steps back if it was current", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.follow(note("c"));
    t.remove(t.layout()[1].id);
    expect(t.size).toBe(1);
    expect(here(t)).toBe("a");
    expect(t.canForward).toBe(false);
  });

  it("resets to the current note when the start of the trail is removed", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    t.remove(t.layout()[0].id);
    expect(t.size).toBe(1);
    expect(here(t)).toBe("b");
  });

  it("folds side branches but never the way to the current note", () => {
    const t = new Trail(note("a"));
    t.follow(note("b"));
    const root = t.layout()[0].id;
    t.select(root);
    t.follow(note("c"));
    t.select(root);
    t.toggleCollapsed(root);
    expect(t.layout().map((p) => p.id)).toHaveLength(2);
    t.select(t.layout()[1].id);
    t.toggleCollapsed(root);
    t.toggleCollapsed(root);
    const c = new Trail(note("a"));
    c.follow(note("b"));
    c.select(c.layout()[0].id);
    c.follow(note("c"));
    c.toggleCollapsed(c.layout()[0].id);
    expect(c.layout()).toHaveLength(3);
  });

  it("restores a saved trail and drops notes that no longer exist with their branches", () => {
    const t = new Trail(note("a"));
    t.follow(note("gone"));
    t.follow(note("c"));
    const restored = Trail.restore(JSON.parse(JSON.stringify(t.save())), (v) => v.kind === "note" && v.path !== "gone")!;
    expect(restored.size).toBe(1);
    expect(here(restored)).toBe("a");
  });

  it("rejects saved data of the wrong shape", () => {
    expect(Trail.restore({ path: "a", scroll: 0 }, () => true)).toBeNull();
    expect(Trail.restore({ nodes: [{ id: "x" }], root: 1, current: 1 }, () => true)).toBeNull();
    expect(Trail.restore(null, () => true)).toBeNull();
  });
});
