import { describe, expect, it } from "vitest";
import { VaultIndex } from "../../src/vault/index";
import { linkMoves, nameProblem, rewriteLinks } from "../../src/vault/link-rewrite";

/** Rewrites `text`, written in `source`, for the given moves in a vault of `files`. */
const moved = (text: string, files: string[], moves: Record<string, string>, source = "Other.md") =>
  rewriteLinks(text, source, linkMoves(new VaultIndex([...files, source]), new Map(Object.entries(moves))));
const rename = (text: string, others: string[] = []) =>
  moved(text, ["Notes/Old.md", ...others], { "Notes/Old.md": "Notes/New.md" });

describe("rewriteLinks", () => {
  it("follows a rename and keeps headings and aliases", () => {
    expect(rename("[[Old]] [[Old#Part]] [[Old|see this]] [[Old#Part|see]]")).toBe(
      "[[New]] [[New#Part]] [[New|see this]] [[New#Part|see]]",
    );
  });

  it("updates embeds", () => {
    expect(rename("![[Old]]")).toBe("![[New]]");
  });

  it("ignores case and keeps a folder when the link had one", () => {
    expect(rename("[[old]] [[Notes/Old]]")).toBe("[[New]] [[Notes/New]]");
  });

  it("leaves other notes, aliases and similar names alone", () => {
    const text = "[[Older]] [[Other/Old thing]] [[Nick]]";
    expect(rename(text)).toBe(text);
  });

  it("leaves code alone", () => {
    const text = "`[[Old]]`\n\n```\n[[Old]]\n```\n";
    expect(rename(text)).toBe(text);
  });

  it("adds the folder when the new name would be ambiguous", () => {
    expect(rename("[[Old]]", ["Elsewhere/New.md"])).toBe("[[Notes/New]]");
  });

  it("follows a move, changing only links written with a folder", () => {
    expect(moved("[[Old]] [[Notes/Old]]", ["Notes/Old.md"], { "Notes/Old.md": "Archive/Old.md" })).toBe(
      "[[Old]] [[Archive/Old]]",
    );
  });

  it("updates Markdown links, encoded or not", () => {
    expect(rename("[a](Old.md) [b](Notes/Old.md)")).toBe("[a](New.md) [b](Notes/New.md)");
    expect(moved("[a](My%20Old.md)", ["My Old.md"], { "My Old.md": "My New.md" })).toBe("[a](My%20New.md)");
  });

  it("keeps an alias inside a table's escaped pipe", () => {
    expect(rename("| [[Old\\|label]] |")).toBe("| [[New\\|label]] |");
  });

  it("leaves a link alone when it really means a different note of the same name", () => {
    expect(moved("[[A/Old]] and [[Old]]", ["A/Old.md", "B/Old.md"], { "A/Old.md": "A/New.md" })).toBe("[[A/New]] and [[Old]]");
  });

  it("leaves links inside a code fence that never closes", () => {
    expect(rename("[[Old]]\n\n```\n[[Old]]\n")).toBe("[[New]]\n\n```\n[[Old]]\n");
  });

  it("leaves everything else byte for byte", () => {
    expect(rename("a\r\n[[Old]]\r\n\tb  \r\n")).toBe("a\r\n[[New]]\r\n\tb  \r\n");
  });
});

describe("rewriteLinks with Markdown links", () => {
  const files = ["A/Old.md", "A/Near.md", "B/Far.md", "B/Deep/Under.md"];

  it("follows a rename from the note's own folder", () => {
    expect(moved("[x](Old.md) [y](./Old.md)", files, { "A/Old.md": "A/New.md" }, "A/Near.md")).toBe("[x](New.md) [y](./New.md)");
  });

  it("follows a rename through a parent folder", () => {
    expect(moved("[x](../A/Old.md)", files, { "A/Old.md": "A/New.md" }, "B/Far.md")).toBe("[x](../A/New.md)");
  });

  it("recomputes the path when the target moves to another folder", () => {
    expect(moved("[x](../A/Old.md)", files, { "A/Old.md": "B/Deep/Old.md" }, "B/Far.md")).toBe("[x](Deep/Old.md)");
  });

  it("keeps a moved note's own relative links working", () => {
    expect(moved("[x](../B/Far.md) [y](Near.md)", files, { "A/Old.md": "B/Deep/Old.md" }, "A/Old.md")).toBe(
      "[x](../Far.md) [y](../../A/Near.md)",
    );
  });

  it("keeps a link pointing at what it meant when two notes share the name", () => {
    expect(moved("[x](Old.md)", [...files, "B/Old.md"], { "B/Old.md": "B/New.md" }, "A/Near.md")).toBe("[x](Old.md)");
    expect(moved("[x](Old.md)", [...files, "B/Old.md"], { "A/Old.md": "A/New.md" }, "A/Near.md")).toBe("[x](New.md)");
  });

  it("keeps headings, titles, angle brackets and the missing extension", () => {
    const go = (text: string) => moved(text, files, { "A/Old.md": "A/Brand New.md" }, "A/Near.md");
    expect(go("[x](Old.md#Part)")).toBe("[x](Brand%20New.md#Part)");
    expect(go('[x](Old.md "Title")')).toBe('[x](Brand%20New.md "Title")');
    expect(go("[x](<Old.md>)")).toBe("[x](<Brand New.md>)");
    expect(go("[x](Old)")).toBe("[x](Brand%20New)");
  });

  it("writes brackets so the link still parses", () => {
    expect(moved("[x](Old.md)", files, { "A/Old.md": "A/a) b.md" }, "A/Near.md")).toBe("[x](a%29%20b.md)");
    expect(moved("[x](Node%20(notes).md)", ["A/Node (notes).md"], { "A/Node (notes).md": "A/N.md" }, "A/Z.md")).toBe("[x](N.md)");
  });

  it("leaves URLs, broken escapes, links out of the vault and code alone", () => {
    const text = "[a](https://x.dev/Old.md) [b](100%.md) [c](../../../Old.md) [d](#Old) `[e](Old.md)`";
    expect(moved(text, files, { "A/Old.md": "A/New.md" }, "A/Near.md")).toBe(text);
  });

  it("does not touch a link whose target and note both stayed put", () => {
    expect(moved("[x](Near.md)", files, { "A/Old.md": "A/New.md" }, "A/Z.md")).toBe("[x](Near.md)");
  });
});

describe("rewriteLinks when a folder is renamed", () => {
  const files = ["Old/One.md", "Old/Sub/Two.md", "Old/pic.png", "Top.md"];
  const all = { "Old/One.md": "New/One.md", "Old/Sub/Two.md": "New/Sub/Two.md", "Old/pic.png": "New/pic.png" };

  it("updates path links to notes and attachments and leaves bare names", () => {
    expect(moved("[[Old/One]] [[One]] ![[Old/pic.png]] ![[pic.png]]", files, all)).toBe(
      "[[New/One]] [[One]] ![[New/pic.png]] ![[pic.png]]",
    );
  });

  it("updates Markdown links from outside, images included", () => {
    expect(moved("[a](Old/Sub/Two.md) ![b](Old/pic.png)", files, all, "Top.md")).toBe("[a](New/Sub/Two.md) ![b](New/pic.png)");
  });

  it("needs no change for relative links between notes that moved together", () => {
    const text = "[a](Sub/Two.md) ![b](pic.png)";
    expect(moved(text, files, all, "Old/One.md")).toBe(text);
  });

  it("fixes a moved note's links that climb out only when the depth changed", () => {
    expect(moved("[a](../Top.md)", files, all, "Old/One.md")).toBe("[a](../Top.md)");
    expect(moved("[a](../Top.md)", files, { "Old/One.md": "Now/Deep/One.md" }, "Old/One.md")).toBe("[a](../../Top.md)");
  });
});

describe("nameProblem", () => {
  it("accepts ordinary names, including spaces, dots and brackets of the round kind", () => {
    expect(nameProblem("Node.js (notes) - part 2")).toBeNull();
  });

  it.each(["", "   ", ".hidden", "a/b", "a\\b", "a:b", "a#b", "a^b", "a[b", "a]b", "a|b"])("refuses %j", (name) => {
    expect(nameProblem(name)).not.toBeNull();
  });
});
