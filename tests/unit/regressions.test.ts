// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Highlighter } from "../../src/render/highlight";
import { renderNote } from "../../src/render/note";
import { sanitize } from "../../src/render/sanitize";
import { fuzzy, highlightMarks } from "../../src/ui/fuzzy";
import { parseFrontmatter } from "../../src/vault/frontmatter";
import { VaultIndex } from "../../src/vault/index";
import { LinkGraph, plainText } from "../../src/vault/links";
import { SearchIndex } from "../../src/vault/search";
import { Trail, type View } from "../../src/vault/trail";

const note = (path: string): View => ({ kind: "note", path });
const highlighter = { prepare: async () => {}, highlight: () => null } as unknown as Highlighter;

async function html(source: string, files: string[]): Promise<HTMLElement> {
  const index = new VaultIndex(files);
  const { fragment } = await renderNote(source, files[0], { index, highlighter, assetUrl: (p) => `/@vault/file?path=${p}` });
  const div = document.createElement("div");
  div.append(fragment);
  return div;
}

describe("notes with a dot in their name", () => {
  const files = ["A.md", "Notes/Node.js.md", "Attachments/photo.png"];

  it("opens as a note, not an attachment", async () => {
    const link = (await html("[[Node.js]]", files)).querySelector("a")!;
    expect(link.className).toBe("wikilink");
    expect(link.dataset.path).toBe("Notes/Node.js.md");
  });

  it("counts as a link in the graph", () => {
    const links = new LinkGraph(new VaultIndex(files));
    links.update("A.md", "[[Node.js]]");
    expect([...(links.out.get("A.md") ?? [])]).toEqual(["Notes/Node.js.md"]);
  });

  it("leaves real attachments as attachments", async () => {
    expect((await html("![[photo.png]]", files)).querySelector("img.embed-image")).not.toBeNull();
  });
});

describe("sanitizer blocks remote loads by itself", () => {
  const clean = (input: string) => {
    const div = document.createElement("div");
    div.append(sanitize(input));
    return div;
  };

  it.each([
    ['<video src="https://evil.test/v.mp4"></video>', "evil.test"],
    ['<audio src="https://evil.test/a.mp3"></audio>', "evil.test"],
    ['<span style="background:url(https://evil.test/x.png)">x</span>', "evil.test"],
    ['<svg><image href="https://evil.test/x.svg"></image></svg>', "evil.test"],
    ['<span class="remote-image" data-src="file:///etc/hosts">x</span>', "file:"],
  ])("%s", (input, leaked) => {
    expect(clean(input).innerHTML).not.toContain(leaked);
  });

  it("keeps ordinary links and the styles code highlighting needs", () => {
    const out = clean('<a href="https://example.com">x</a><span style="color:var(--shiki)">y</span>');
    expect(out.querySelector("a")!.getAttribute("href")).toBe("https://example.com");
    expect(out.querySelector("span")!.getAttribute("style")).toContain("--shiki");
  });
});

describe("trail restore", () => {
  it("keeps a note that removing another reattached to a later stop", () => {
    const trail = new Trail(note("a"));
    trail.follow(note("b"));
    const b = trail.current.id;
    trail.follow(note("c"));
    const a = [...trail.layout()][0].id;
    trail.select(a);
    trail.follow(note("d"));
    trail.follow(note("c"));
    trail.remove(b);
    const saved = JSON.parse(JSON.stringify(trail.save()));
    const restored = Trail.restore(saved, () => true)!;
    expect(restored.size).toBe(trail.size);
    expect(
      restored
        .views()
        .map((v) => (v.kind === "note" ? v.path : ""))
        .sort(),
    ).toEqual(["a", "c", "d"]);
  });
});

describe("palette highlighting", () => {
  it("marks the right letters after an emoji", () => {
    const container = document.createElement("div");
    container.append(highlightMarks("🙂 Bread", fuzzy("bread", "🙂 Bread")!.marks));
    expect(container.querySelector("mark")!.textContent).toBe("Bread");
  });
});

describe("frontmatter", () => {
  it("recognises an empty block", () => {
    expect(parseFrontmatter("---\n---\nbody").body).toBe("body");
  });
  it("is left out of search text with Windows line endings", () => {
    expect(plainText("---\r\nkey: hidden\r\n---\r\nbody")).not.toContain("hidden");
  });
});

describe("phrase search", () => {
  it("finds a rare phrase beyond the first page of word matches", () => {
    const search = new SearchIndex();
    for (let i = 0; i < 30; i++) search.set(`n${i}.md`, `Note ${i}`, "alpha alpha alpha beta beta beta".repeat(3));
    search.set("target.md", "Target", "one alpha beta two");
    expect(search.search('"alpha beta two"', 2).map((h) => h.path)).toEqual(["target.md"]);
  });
});
