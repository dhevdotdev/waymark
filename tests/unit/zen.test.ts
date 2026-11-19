// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { escapeZen, Zen } from "../../src/ui/zen";

let shell: HTMLElement;
let note: HTMLElement;
let zen: Zen;

beforeAll(() => {
  /* jsdom has no media queries. Reduce Motion is the answer that matters here: nothing glides. */
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query })) as typeof window.matchMedia;
});

beforeEach(() => {
  document.body.innerHTML = `
    <div class="shell sidebar-closed sidebar-peek">
      <nav class="sidebar"><button class="row">Row</button></nav>
      <main class="reader"><div class="scroller" tabindex="-1"></div></main>
    </div>`;
  shell = document.querySelector(".shell")!;
  note = document.querySelector(".scroller")!;
  zen = new Zen(shell, note);
});

describe("Zen", () => {
  it("only adds a class, so each panel keeps its own state", () => {
    zen.enter();
    expect(zen.isOn).toBe(true);
    expect(shell.classList.contains("sidebar-closed")).toBe(true);
    zen.leave();
    expect(shell.className).toBe("shell sidebar-closed");
  });

  it("puts away a floating panel rather than leaving it over the note", () => {
    zen.enter();
    expect(shell.classList.contains("sidebar-peek")).toBe(false);
  });

  it("moves focus out of a panel it hides, to the note", () => {
    document.querySelector<HTMLElement>(".row")!.focus();
    zen.enter();
    expect(document.activeElement).toBe(note);
  });

  it("toggles, and says whether leaving did anything", () => {
    zen.toggle();
    expect(zen.isOn).toBe(true);
    zen.toggle();
    expect(zen.isOn).toBe(false);
    expect(zen.leave()).toBe(false);
  });
});

describe("Escape in zen", () => {
  it("leaves when nothing else wants it", () => {
    zen.enter();
    expect(escapeZen(shell, false)).toBe(true);
    expect(zen.isOn).toBe(false);
  });

  it("stays with a text field", () => {
    zen.enter();
    expect(escapeZen(shell, true)).toBe(false);
    expect(zen.isOn).toBe(true);
  });

  it("waits for an open palette or menu", () => {
    zen.enter();
    for (const kind of ["palette-overlay", "context-menu"]) {
      const layer = document.createElement("div");
      layer.className = kind;
      document.body.append(layer);
      expect(escapeZen(shell, false)).toBe(false);
      layer.classList.add("is-leaving");
    }
    expect(escapeZen(shell, false)).toBe(true);
  });

  it("does nothing outside zen", () => {
    expect(escapeZen(shell, false)).toBe(false);
  });
});
