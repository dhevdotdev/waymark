import { describe, expect, it } from "vitest";
import { captureName, captureNames } from "../../src/vault/capture-name";

describe("captureName", () => {
  it("takes the first line that has words", () => {
    expect(captureName("\n\n  Call the plumber about the leak\nmore detail\n")).toBe("Call the plumber about the leak");
  });

  it("drops the marks that say how a line is written", () => {
    expect(captureName("# Groceries")).toBe("Groceries");
    expect(captureName("- [ ] Renew passport")).toBe("Renew passport");
    expect(captureName("> A quote worth keeping")).toBe("A quote worth keeping");
    expect(captureName("3. Third idea")).toBe("Third idea");
  });

  it("removes what a name cannot hold, and dots at either end", () => {
    expect(captureName("Q3: plan/budget [draft] #work?")).toBe("Q3 plan budget draft work");
    expect(captureName("...hidden.")).toBe("hidden");
    expect(captureName('a*b"c<d>e|f^g\\h')).toBe("a b c d e f g h");
  });

  it("cuts a long line at a word", () => {
    const name = captureName("This is a very long first line that keeps going well past what fits in a file name comfortably");
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toBe("This is a very long first line that keeps going well past");
    expect(captureName("x".repeat(80))).toBe("x".repeat(60));
  });

  it("falls back to Untitled when the first line has nothing usable", () => {
    expect(captureName("")).toBe("Untitled");
    expect(captureName("###")).toBe("Untitled");
    expect(captureName("/// ::: |||")).toBe("Untitled");
  });
});

describe("captureNames", () => {
  it("numbers from 2 and stops at the limit", () => {
    expect([...captureNames("Idea", 4)]).toEqual(["Idea", "Idea 2", "Idea 3", "Idea 4"]);
  });
});
