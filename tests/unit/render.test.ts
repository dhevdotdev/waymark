// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Highlighter } from "../../src/render/highlight";
import { renderNote } from "../../src/render/note";
import { VaultIndex } from "../../src/vault/index";

const index = new VaultIndex(["Notes/A.md", "Notes/B.md", "Inbox/B.md", "Attachments/pic.png"]);
const highlighter = { prepare: async () => {}, highlight: () => null } as unknown as Highlighter;
const render = async (md: string) => {
  const { fragment, headings } = await renderNote(md, "Notes/A.md", {
    index,
    highlighter,
    assetUrl: (p) => `/@vault/file?path=${encodeURIComponent(p)}`,
  });
  const div = document.createElement("div");
  div.append(fragment);
  return { div, headings };
};

describe("renderNote", () => {
  it("renders wikilinks, aliases, heading links, missing and ambiguous targets", async () => {
    const { div } = await render("[[A]] [[A#Part two|see]] [[#Local]] [[Nope]] [[B]]");
    const links = [...div.querySelectorAll(".wikilink")];
    expect(links.map((l) => l.textContent)).toEqual(["A", "see", "Local", "Nope", "B"]);
    expect(links[1].getAttribute("data-anchor")).toBe("Part two");
    expect(links[3].classList.contains("is-missing")).toBe(true);
    expect(JSON.parse(links[4].getAttribute("data-candidates")!)).toEqual(["Inbox/B.md", "Notes/B.md"]);
  });

  it("renders callouts with fold state and keeps their lists as written", async () => {
    const { div } = await render("> [!abstract] Terms\n> - **One:** first\n> - **Two:** second\n\n> [!note]- Hidden\n> body");
    const [terms, folded] = div.querySelectorAll(".callout");
    expect(terms.getAttribute("data-callout")).toBe("abstract");
    expect([...terms.querySelectorAll("li strong")].map((t) => t.textContent)).toEqual(["One:", "Two:"]);
    expect(folded.getAttribute("data-fold")).toBe("closed");
    expect(folded.querySelector(".callout-label")!.textContent).toBe("Hidden");
  });

  it("embeds vault images and flags missing ones", async () => {
    const { div } = await render("![[pic.png]] ![[gone.png]]");
    expect(div.querySelector("img.embed-image")!.getAttribute("src")).toContain("Attachments%2Fpic.png");
    expect(div.querySelector(".embed-missing")!.textContent).toContain("gone.png");
  });

  it("renders highlights, hides comments and keeps math", async () => {
    const { div } = await render("==marked== %%secret%% $x^2$");
    expect(div.querySelector("mark")!.textContent).toBe("marked");
    expect(div.textContent).not.toContain("secret");
    expect(div.querySelector(".katex")).not.toBeNull();
  });

  it("strips scripts, handlers, javascript: URLs, app actions and remote loads", async () => {
    const { div } = await render(
      '<script>alert(1)</script><img src="https://evil.test/x.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a><span data-act="theme">t</span><iframe src="https://evil.test"></iframe>\n\n![remote](https://evil.test/y.png)',
    );
    const html = div.innerHTML;
    expect(html).not.toMatch(/<script|onerror|javascript:|data-act|<iframe|\ssrc="https:\/\/evil/);
    expect(div.querySelectorAll(".remote-image").length).toBe(2);
  });

  it("gives duplicate headings unique ids", async () => {
    const { headings } = await render("## Setup\n\n## Setup");
    expect(headings.map((h) => h.id)).toEqual(["h-setup", "h-setup-1"]);
  });
});

describe("ordered lists", () => {
  it("keep their starting number with drawn markers", async () => {
    const { div } = await render("3. three\n4. four");
    const list = div.querySelector("ol") as HTMLOListElement;
    expect(list.getAttribute("start")).toBe("3");
    expect(list.style.getPropertyValue("--list-start")).toBe("2");
  });
});
