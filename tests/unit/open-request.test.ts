import { describe, expect, it } from "vitest";
import { VaultIndex } from "../../src/vault/index";
import { noteNamed, vaultHolding } from "../../src/vault/open-request";

describe("vaultHolding", () => {
  const roots = ["/Users/me/Notes", "/Users/me/Notes/Work", "/Users/me/Other/"];

  it("finds the vault a file sits in, and its path inside it", () => {
    expect(vaultHolding("/Users/me/Notes/Ideas/A.md", roots)).toEqual({ root: "/Users/me/Notes", path: "Ideas/A.md" });
    expect(vaultHolding("/Users/me/Other/B.md", roots)).toEqual({ root: "/Users/me/Other/", path: "B.md" });
  });

  it("prefers the deepest vault when one is inside another", () => {
    expect(vaultHolding("/Users/me/Notes/Work/Plan.md", roots)).toEqual({ root: "/Users/me/Notes/Work", path: "Plan.md" });
  });

  it("does not mistake a sibling folder with a longer name for the vault", () => {
    expect(vaultHolding("/Users/me/Notes2/A.md", roots)).toBeNull();
    expect(vaultHolding("/Users/me/A.md", roots)).toBeNull();
    expect(vaultHolding("/Users/me/A.md", [])).toBeNull();
  });
});

describe("noteNamed", () => {
  const index = new VaultIndex(["Plans/Next steps.md", "Ideas.md", "a/Same.md", "b/Same.md", "photo.png"]);

  it("takes a path with or without its extension, ignoring case", () => {
    expect(noteNamed(index, "Plans/Next steps.md")).toEqual({ kind: "found", path: "Plans/Next steps.md" });
    expect(noteNamed(index, "plans/next steps")).toEqual({ kind: "found", path: "Plans/Next steps.md" });
  });

  it("takes a bare name as a link would", () => {
    expect(noteNamed(index, "Next steps")).toEqual({ kind: "found", path: "Plans/Next steps.md" });
  });

  it("refuses a name that matches more than one note, or none", () => {
    expect(noteNamed(index, "Same").kind).toBe("refused");
    expect(noteNamed(index, "Missing").kind).toBe("refused");
    expect(noteNamed(index, "photo.png").kind).toBe("refused");
    expect(noteNamed(index, "../Ideas.md").kind).toBe("refused");
  });
});
