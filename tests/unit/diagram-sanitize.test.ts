// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeDiagram } from "../../src/render/sanitize";

const clean = (svg: string) => {
  const div = document.createElement("div");
  div.append(sanitizeDiagram(svg));
  return div;
};

const DRAWN = `<svg id="mmd-1" role="graphics-document document" aria-roledescription="flowchart-v2" viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><style>#mmd-1 .node rect{fill:var(--ink);}</style><defs><marker id="mmd-1_pointEnd" refX="5" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><g class="node" data-id="A" transform="translate(10, 10)"><rect width="40" height="20" style="fill:color-mix(in oklab, var(--p-surface0) 55%, var(--code-bg))"></rect><foreignObject width="40" height="20"><div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell;"><span class="nodeLabel"><p>Mix <b>it</b></p></span></div></foreignObject></g><path d="M0 0L10 10" marker-end="url(#mmd-1_pointEnd)"></path></svg>`;

describe("diagram sanitizer", () => {
  it("keeps everything a drawn diagram is made of", () => {
    const before = document.createElement("div");
    before.innerHTML = DRAWN;
    expect(clean(DRAWN).innerHTML).toBe(before.innerHTML);
  });

  it.each([
    ["<svg><script>alert(1)</script></svg>", "alert"],
    ['<svg onload="alert(1)"><g></g></svg>', "onload"],
    ['<svg><a href="javascript:alert(1)"><text>x</text></a></svg>', "javascript:"],
    ['<svg><image href="https://evil.test/x.png"></image></svg>', "evil.test"],
    ['<svg><use href="https://evil.test/s.svg#a"></use></svg>', "evil.test"],
    ['<svg><foreignObject><div><img src="x" onerror="alert(1)"></div></foreignObject></svg>', "onerror"],
    ['<svg><foreignObject><iframe src="https://evil.test"></iframe></foreignObject></svg>', "iframe"],
    ["<svg><foreignObject><style>body{display:none}</style></foreignObject></svg>", "display:none"],
    ["<svg><foreignObject><svg><script>alert(1)</script></svg></foreignObject></svg>", "alert"],
  ])("%s", (input, leaked) => {
    expect(clean(input).innerHTML).not.toContain(leaked);
  });

  it("puts each label back in its own place", () => {
    const out = clean(
      "<svg><foreignObject><span>first</span></foreignObject><g><foreignObject><span>second</span></foreignObject></g></svg>",
    );
    expect([...out.querySelectorAll("foreignObject")].map((f) => f.textContent)).toEqual(["first", "second"]);
    expect(out.querySelector("[data-label]")).toBeNull();
  });
});
