import { describe, expect, it } from "vitest";
import { VaultIndex } from "../../src/vault/index";
import { LinkGraph, plainText } from "../../src/vault/links";

const chain = () => {
  const graph = new LinkGraph(new VaultIndex(["a.md", "b.md", "c.md", "d.md"]));
  graph.update("a.md", "[[b]]");
  graph.update("b.md", "[[c]]");
  graph.update("c.md", "[[d]]");
  return graph;
};

describe("LinkGraph", () => {
  it("counts a Markdown link to a note, relative or not, but not an image or URL", () => {
    const graph = new LinkGraph(new VaultIndex(["A/a.md", "A/b.md", "C/c.md", "A/p.png"]));
    graph.update("A/a.md", '[1](b.md) [2](../C/c.md "t") ![3](p.png) [4](https://x.dev/c.md) `[5](d.md)`');
    expect(graph.backlinks("A/b.md")).toEqual(["A/a.md"]);
    expect(graph.backlinks("C/c.md")).toEqual(["A/a.md"]);
    expect([...graph.out.get("A/a.md")!].sort()).toEqual(["A/b.md", "C/c.md"]);
  });

  it("reports backlinks", () => {
    expect(chain().backlinks("c.md")).toEqual(["b.md"]);
  });

  it("counts links in both directions", () => {
    expect(chain().degree("b.md")).toBe(2);
    expect(chain().degree("a.md")).toBe(1);
  });

  it("finds the neighbourhood within a depth, in either direction", () => {
    expect([...chain().neighbourhood("b.md", 1)].sort()).toEqual(["a.md", "b.md", "c.md"]);
    expect([...chain().neighbourhood("a.md", 2)].sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("drops old backlinks when a note changes", () => {
    const graph = chain();
    graph.update("a.md", "[[d]]");
    expect(graph.backlinks("b.md")).toEqual([]);
    expect(graph.backlinks("d.md")).toEqual(["a.md", "c.md"]);
  });

  it("forgets a removed note's links", () => {
    const graph = chain();
    graph.update("b.md", null);
    expect(graph.backlinks("c.md")).toEqual([]);
  });

  it("ignores links inside code and links to itself", () => {
    const graph = new LinkGraph(new VaultIndex(["a.md", "b.md"]));
    graph.update("a.md", "`[[b]]`\n\n```\n[[b]]\n```\n\n[[a]]");
    expect([...(graph.out.get("a.md") ?? [])]).toEqual([]);
  });
});

describe("plainText", () => {
  it("keeps what a reader sees and removes the markup", () => {
    expect(plainText("## Title\n\n**Bold** [[Target|shown]] [text](http://x) %%hidden%%").trim()).toBe(
      "Title\n\nBold shown text",
    );
  });
});
