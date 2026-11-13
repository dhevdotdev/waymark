import { describe, expect, it } from "vitest";
import { foldable, noteSections, sectionAt } from "../../src/vault/sections";

const lines = (...rows: string[]) => rows.join("\n");
const summary = (source: string) =>
  noteSections(source).map(({ line, level, key, end, last }) => ({ line, level, key, end, last }));

describe("noteSections", () => {
  it("ends a section at the next heading of the same or a higher level", () => {
    const source = lines("# One", "text", "## Two", "more", "### Three", "deep", "## Four", "end", "# Five", "x");
    expect(summary(source)).toEqual([
      { line: 0, level: 1, key: "one#0", end: 8, last: 7 },
      { line: 2, level: 2, key: "two#0", end: 6, last: 5 },
      { line: 4, level: 3, key: "three#0", end: 6, last: 5 },
      { line: 6, level: 2, key: "four#0", end: 8, last: 7 },
      { line: 8, level: 1, key: "five#0", end: 10, last: 9 },
    ]);
  });

  it("does not read a heading inside fenced code, a list item or a quote", () => {
    const source = lines(
      "## Shell",
      "```bash",
      "# a comment",
      "```",
      "~~~~",
      "## still code",
      "~~~~",
      "- item",
      "  ## inside the item",
      "> ## quoted",
      "## Next",
      "x",
    );
    expect(summary(source).map((s) => s.key)).toEqual(["shell#0", "next#0"]);
    expect(summary(source)[0]).toMatchObject({ end: 10, last: 9 });
  });

  it("reads setext headings from the paragraph they underline", () => {
    const source = lines("Title", "spans two", "=====", "", "body", "", "Part", "---", "text", "", "- item", "---");
    const sections = noteSections(source);
    expect(sections.map(({ line, headEnd, level, text }) => ({ line, headEnd, level, text }))).toEqual([
      { line: 0, headEnd: 2, level: 1, text: "Title\nspans two" },
      { line: 6, headEnd: 7, level: 2, text: "Part" },
    ]);
  });

  it("treats a rule after a quote's lazy line or a list as a rule, not a heading", () => {
    expect(noteSections(lines("> quote", "lazy", "---", "", "- a", "lazy", "---"))).toEqual([]);
  });

  it("skips frontmatter, whose fences would otherwise read as rules and headings", () => {
    const source = lines("---", "title: x", "---", "## Body", "text");
    expect(summary(source)).toEqual([{ line: 3, level: 2, key: "body#0", end: 5, last: 4 }]);
  });

  it("keeps a heading at the end of the file, which holds nothing to fold", () => {
    const source = lines("## First", "text", "", "## Last");
    expect(summary(source)).toEqual([
      { line: 0, level: 2, key: "first#0", end: 3, last: 1 },
      { line: 3, level: 2, key: "last#0", end: 4, last: -1 },
    ]);
    expect(foldable(noteSections(source)).map((s) => s.key)).toEqual(["first#0"]);
    expect(summary(`${source}\n`)[1]).toMatchObject({ end: 5, last: -1 });
  });

  it("strips closing hashes and keys repeated headings by occurrence", () => {
    const source = lines("## Notes ##", "a", "## *Notes*", "b", "## Other", "c");
    expect(noteSections(source).map((s) => s.key)).toEqual(["notes#0", "notes#1", "other#0"]);
  });

  it("keeps a heading's key when text elsewhere changes", () => {
    const before = noteSections(lines("## Setup", "one", "## Usage", "two", "## Setup", "three"));
    const after = noteSections(lines("intro", "", "## Setup", "one, edited", "", "more", "## Usage", "## Setup", "x"));
    expect(after.map((s) => s.key)).toEqual(before.map((s) => s.key));
    expect(after.map((s) => s.line)).toEqual([2, 6, 7]);
  });

  it("is not fooled by tags or Windows line endings", () => {
    expect(noteSections("#tag\r\n## Real\r\ntext\r\n")).toMatchObject([{ line: 1, key: "real#0", last: 2 }]);
  });

  it("finds the innermost foldable section around a line", () => {
    const sections = noteSections(lines("## A", "a", "### B", "b", "## C", "c"));
    expect(sectionAt(sections, 3)?.key).toBe("b#0");
    expect(sectionAt(sections, 1)?.key).toBe("a#0");
    expect(sectionAt(sections, 0)?.key).toBe("a#0");
  });
});

describe("noteSections and the reading view", () => {
  const tricky = [
    lines("# A", "```", "# no", "```", "Para", "===", "- list", "  # in list", "> # quote", "## B", "x"),
    lines("text", "    # indented code", "", "    # code", "## C", "* * *", "Under", "---", "| a | b |", "|---|---|", "## D"),
    lines("1. one", "", "   ## inside", "", "## E", "~~~", "## no", "~~~", "#tag", "## F ##", "Lazy", "> q", "lazy", "---"),
  ];

  it("finds the same top-level headings markdown-it renders", async () => {
    const { createMarkdown } = await import("../../src/render/markdown");
    const md = createMarkdown();
    for (const source of tricky) {
      const rendered = md
        .parse(source, { headings: [] })
        .filter((t) => t.type === "heading_open" && t.level === 0)
        .map((t) => t.map![0]);
      expect(noteSections(source).map((s) => s.line)).toEqual(rendered);
    }
  });
});
