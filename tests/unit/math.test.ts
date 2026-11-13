// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Highlighter } from "../../src/render/highlight";
import { renderNote } from "../../src/render/note";
import { editorHasMath } from "../../src/ui/editor-blocks";
import { VaultIndex } from "../../src/vault/index";

const katexLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock("katex", async (importOriginal) => {
  katexLoads.count++;
  return importOriginal();
});

const highlighter = { prepare: async () => {}, highlight: () => null } as unknown as Highlighter;
const deps = { index: new VaultIndex(["A.md"]), highlighter, assetUrl: (p: string) => p };
const render = async (md: string) => {
  const div = document.createElement("div");
  div.append((await renderNote(md, "A.md", deps)).fragment);
  return div;
};

describe("math loads only for notes that have it", () => {
  it("never loads KaTeX for a note without math", async () => {
    const div = await render("It costs $5 and $10.\n\n`$x$` and\n\n```\n$$\ny\n$$\n```\n\n> [!note] Prices $5 to $9");
    expect(katexLoads.count).toBe(0);
    expect(div.textContent).toContain("$5 and $10");
    expect(div.querySelector(".katex")).toBeNull();
  });

  it("draws math in the first render of a note that has it, callout titles included", async () => {
    const div = await render("> [!note] Energy $E=mc^2$\n> Body $x^2$\n\n$$\n\\int_0^1 y\n$$\n\n| a |\n|---|\n| $z$ |");
    expect(katexLoads.count).toBe(1);
    expect(div.querySelectorAll(".katex")).toHaveLength(4);
    expect(div.querySelector(".callout-label .katex")).not.toBeNull();
    expect(div.textContent).not.toContain("$");
  });

  it("loads KaTeX once however many notes have math", async () => {
    await render("$a$");
    await render("$$\nb\n$$");
    expect(katexLoads.count).toBe(1);
  });
});

describe("editorHasMath", () => {
  it("finds the math the editor draws", () => {
    expect(editorHasMath("Inline $a^2$ here.")).toBe(true);
    expect(editorHasMath("Before\n\n$$\n\\int_0^1 x\n$$\n\nAfter")).toBe(true);
    expect(editorHasMath("$$x$$")).toBe(true);
  });

  it("ignores dollars that are not math", () => {
    expect(editorHasMath("No dollars at all.")).toBe(false);
    expect(editorHasMath("It costs $5 and $10.")).toBe(false);
    expect(editorHasMath("A $ sign and $ another.")).toBe(false);
    expect(editorHasMath("Escaped \\$x$ stays text.")).toBe(false);
    expect(editorHasMath("Code `$x$` and ``$$y$$`` stays code.")).toBe(false);
    expect(editorHasMath("```tex\n$$\ny\n$$\n$z$\n```\nAfter")).toBe(false);
    expect(editorHasMath("~~~\n$z$\n~~~\nBut $w$ is math.")).toBe(true);
  });
});
