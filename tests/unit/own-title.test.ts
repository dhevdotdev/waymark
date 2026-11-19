import { describe, expect, it } from "vitest";
import { levelOneHeading, opensWithTitle } from "../../src/vault/own-title";

describe("a note that opens with its own name", () => {
  it("matches a first heading that says the file name", () => {
    expect(opensWithTitle("# Reading list\n\nText.\n", "Reading list")).toBe(true);
  });

  it("ignores case, spacing, closing marks and the blank lines before it", () => {
    expect(opensWithTitle("\n\n  #   reading   LIST  ##\r\nText", "Reading list")).toBe(true);
  });

  it("looks past the frontmatter", () => {
    expect(opensWithTitle("---\ntags: [a]\n---\n# Reading list\n", "Reading list")).toBe(true);
  });

  it("leaves every other note alone", () => {
    expect(opensWithTitle("# Something else\n", "Reading list")).toBe(false);
    expect(opensWithTitle("Intro.\n\n# Reading list\n", "Reading list")).toBe(false);
    expect(opensWithTitle("## Reading list\n", "Reading list")).toBe(false);
    expect(opensWithTitle("#Reading list\n", "Reading list")).toBe(false);
    expect(opensWithTitle("    # Reading list\n", "Reading list")).toBe(false);
    expect(opensWithTitle("", "Reading list")).toBe(false);
    expect(opensWithTitle("---\ntitle: x\n---\n", "Reading list")).toBe(false);
  });

  it("reads a level-one heading's text", () => {
    expect(levelOneHeading("# Title #")).toBe("Title");
    expect(levelOneHeading("# ")).toBeNull();
    expect(levelOneHeading("Title")).toBeNull();
  });
});
