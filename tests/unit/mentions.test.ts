import { describe, expect, it } from "vitest";
import { findMentions, linkMention, mentionLink, mentionNames, namePattern, proseOnly } from "../../src/vault/mentions";

const pattern = (...names: string[]) => namePattern(mentionNames(names[0], names.slice(1)))!;
const found = (source: string, ...names: string[]) => findMentions(source, pattern(...names)).map((m) => m.text);

describe("unlinked mentions", () => {
  it("finds the name as a whole word, ignoring case", () => {
    expect(found("Read the reading list. READING LIST too.", "Reading list")).toEqual(["reading list", "READING LIST"]);
    expect(found("Gitlab and git, then digit and git_hub.", "Git")).toEqual(["git"]);
  });

  it("finds aliases, and the longer name where two overlap", () => {
    expect(found("The RL is a reading list.", "Reading list", "RL")).toEqual(["RL", "reading list"]);
    expect(found("Sourdough starter here.", "Sourdough", "Sourdough starter")).toEqual(["Sourdough starter"]);
  });

  it("skips frontmatter, code, comments, math, links, embeds, addresses, tags and HTML", () => {
    const source = [
      "---",
      "title: Git notes",
      "---",
      "Use `git` here.",
      "```",
      "git status",
      "```",
      "<!-- git --> %% git %% $$git$$",
      "[[Git]] [[Other|git]] ![[git.png]] [git](https://git.example) https://example.com/git www.git.org",
      '#git <span title="git">',
      "Then plain git once.",
    ].join("\n");
    expect(found(source, "Git")).toEqual(["git"]);
    expect(findMentions(source, pattern("Git"))[0].at).toBe(source.lastIndexOf("git once"));
  });

  it("keeps every offset and line break when blanking", () => {
    const source = "---\na: 1\n---\nx `y` [[z]]\n";
    const prose = proseOnly(source);
    expect(prose.length).toBe(source.length);
    expect(prose.split("\n").length).toBe(source.split("\n").length);
  });

  it("does not let an unclosed fence hide the rest from blanking", () => {
    expect(found("```\ngit inside\n", "Git")).toEqual([]);
  });

  it("matches names with several words across a run of spaces", () => {
    expect(found("my reading  list", "Reading list")).toEqual(["reading  list"]);
  });

  it("drops one-letter names and repeated names", () => {
    expect(mentionNames("C", ["c", "C lang", "c LANG"])).toEqual(["C lang"]);
    expect(namePattern([])).toBeNull();
  });

  it("shows the words around a mention without list or heading marks", () => {
    const [m] = findMentions("- [ ] Finish the reading list today", pattern("Reading list"));
    expect([m.before, m.text, m.after]).toEqual(["Finish the ", "reading list", " today"]);
    const long = `${"word ".repeat(30)}reading list${" more".repeat(30)}`;
    const [far] = findMentions(long, pattern("Reading list"));
    expect(far.before.startsWith("…")).toBe(true);
    expect(far.after.endsWith("…")).toBe(true);
    expect(far.before.length).toBeLessThan(32);
  });

  it("links the exact occurrence, keeping the words as written when they differ", () => {
    const p = pattern("Reading list");
    const source = "Reading list, then reading list.\n";
    const second = source.lastIndexOf("reading list");
    expect(linkMention(source, p, second, "reading list", "Reading list")).toBe(
      "Reading list, then [[Reading list|reading list]].\n",
    );
    expect(linkMention(source, p, 0, "Reading list", "Reading list")).toBe("[[Reading list]], then reading list.\n");
    expect(mentionLink("Reading list", "Books/Reading list")).toBe("[[Books/Reading list|Reading list]]");
  });

  it("refuses to link text that has changed or is no longer an unlinked mention", () => {
    const p = pattern("Reading list");
    expect(linkMention("A reading lost.", p, 2, "reading list", "Reading list")).toBeNull();
    expect(linkMention("[[reading list]]", p, 2, "reading list", "Reading list")).toBeNull();
  });

  it("stays quick across a large vault", () => {
    const note = `${"Plain prose about sailing and bread with a [[Link]] and `code`.\n".repeat(200)}A reading list.\n`;
    const p = pattern("Reading list", "Books to read");
    const started = performance.now();
    let total = 0;
    for (let i = 0; i < 1000; i++) total += findMentions(note, p).length;
    expect(total).toBe(1000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
