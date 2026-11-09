import { describe, expect, it } from "vitest";
import { nameProblem, rewriteLinks } from "../../src/vault/link-rewrite";

const rename = (text: string, unique = true) => rewriteLinks(text, "Notes/Old.md", "Notes/New.md", unique);

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
    expect(rename("[[Old]]", false)).toBe("[[Notes/New]]");
  });

  it("follows a move, changing only links written with a folder", () => {
    expect(rewriteLinks("[[Old]] [[Notes/Old]]", "Notes/Old.md", "Archive/Old.md", true)).toBe("[[Old]] [[Archive/Old]]");
  });

  it("updates Markdown links, encoded or not", () => {
    expect(rename("[a](Old.md) [b](Notes/Old.md)")).toBe("[a](New.md) [b](Notes/New.md)");
    expect(rewriteLinks("[a](My%20Old.md)", "My Old.md", "My New.md", true)).toBe("[a](My%20New.md)");
  });

  it("keeps an alias inside a table's escaped pipe", () => {
    expect(rename("| [[Old\\|label]] |")).toBe("| [[New\\|label]] |");
  });

  it("leaves a link alone when it really means a different note of the same name", () => {
    const meansTheRenamedNote = (target: string) => target === "A/Old";
    expect(rewriteLinks("[[A/Old]] and [[Old]]", "A/Old.md", "A/New.md", true, meansTheRenamedNote)).toBe(
      "[[A/New]] and [[Old]]",
    );
  });

  it("leaves links inside a code fence that never closes", () => {
    expect(rename("[[Old]]\n\n```\n[[Old]]\n")).toBe("[[New]]\n\n```\n[[Old]]\n");
  });

  it("leaves everything else byte for byte", () => {
    expect(rename("a\r\n[[Old]]\r\n\tb  \r\n")).toBe("a\r\n[[New]]\r\n\tb  \r\n");
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
