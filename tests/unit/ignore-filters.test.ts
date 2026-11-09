import { describe, expect, it } from "vitest";
import { excludedBy } from "../../src/vault/ignore-filters";
import { VaultIndex } from "../../src/vault/index";

describe("excludedBy", () => {
  it("treats plain entries as path prefixes", () => {
    const hidden = excludedBy(["AGENTS.md", "Archive/"]);
    expect(hidden("AGENTS.md")).toBe(true);
    expect(hidden("Archive/old.md")).toBe(true);
    expect(hidden("Notes/AGENTS.md")).toBe(false);
    expect(hidden("Archived.md")).toBe(false);
  });

  it("treats /pattern/ entries as regular expressions", () => {
    const hidden = excludedBy(["/\\.draft\\.md$/"]);
    expect(hidden("Notes/a.draft.md")).toBe(true);
    expect(hidden("Notes/a.md")).toBe(false);
  });

  it("skips what it cannot read, and an empty entry hides nothing", () => {
    const hidden = excludedBy(["", "/(/", 7, null]);
    expect(hidden("Anything.md")).toBe(false);
    expect(excludedBy("not a list")("A.md")).toBe(false);
  });

  it("hides excluded notes from the lists while links still resolve", () => {
    const index = new VaultIndex(["AGENTS.md", "Note.md"], excludedBy(["AGENTS.md"]));
    expect(index.notes).toEqual(["Note.md"]);
    expect(index.allFiles).toEqual(["AGENTS.md", "Note.md"]);
    expect(index.resolve("AGENTS")).toMatchObject({ kind: "found", path: "AGENTS.md" });
  });
});
