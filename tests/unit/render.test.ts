// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Highlighter } from "../../src/render/highlight";
import { renderNote } from "../../src/render/note";
import { VaultIndex } from "../../src/vault/index";

const index = new VaultIndex(["Notes/A.md", "Notes/B.md", "Inbox/B.md", "Attachments/pic.png"]);
const highlighter = { prepare: async () => {}, highlight: () => null } as unknown as Highlighter;
const deps = { index, highlighter, assetUrl: (p: string) => `/@vault/file?path=${encodeURIComponent(p)}` };
const render = async (md: string) => {
  const { fragment, headings } = await renderNote(md, "Notes/A.md", deps);
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

  it("embeds an image written with its folder", async () => {
    const { div } = await render("![[Attachments/pic.png]]");
    expect(div.querySelector("img.embed-image")?.getAttribute("src")).toContain("pic.png");
    expect(div.querySelector(".wikilink")).toBeNull();
  });

  it("makes Markdown links inside the vault work like wikilinks", async () => {
    const { div } = await render(
      "[a](../Notes/A.md#Part) [b](B.md) [c](../Nope.md) [d](../Attachments/pic.png) [e](https://x.dev)",
    );
    const [a, b, c, d, e] = div.querySelectorAll("p a");
    expect(a.getAttribute("data-path")).toBe("Notes/A.md");
    expect(a.getAttribute("data-anchor")).toBe("Part");
    expect(b.getAttribute("data-path")).toBe("Notes/B.md");
    expect(c.classList.contains("is-missing")).toBe(true);
    expect(c.hasAttribute("href")).toBe(false);
    expect(d.getAttribute("data-attachment")).toBe("Attachments/pic.png");
    expect(e.classList.contains("external")).toBe(true);
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

describe("task lists", () => {
  it("draws open and done items and removes the typed brackets", async () => {
    const { div } = await render("- [ ] open\n- [x] done\n- [X] loud\n- plain");
    const items = [...div.querySelectorAll("li")];
    expect(items.map((li) => li.textContent?.trim())).toEqual(["open", "done", "loud", "plain"]);
    expect(items.map((li) => li.querySelector(".task-box")?.getAttribute("aria-checked") ?? null)).toEqual([
      "false",
      "true",
      "true",
      null,
    ]);
    expect(items.map((li) => li.className)).toEqual(["task", "task is-done", "task is-done", ""]);
  });

  it("stays read-only, with no form control in the note", async () => {
    const { div } = await render("- [ ] open");
    expect(div.querySelector("input")).toBeNull();
    expect(div.querySelector(".task-box")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps a wikilink right after the marker", async () => {
    const { div } = await render("- [ ] [[A]] then more");
    expect(div.querySelector("li .wikilink")?.textContent).toBe("A");
    expect(div.querySelector("li")?.textContent?.trim()).toBe("A then more");
  });

  it("works in a loose list", async () => {
    const { div } = await render("- [x] first\n\n- [ ] second");
    expect([...div.querySelectorAll("li > p > .task-box")]).toHaveLength(2);
  });

  it("gives boxes the task's real line when the note has frontmatter and comments", async () => {
    const source = "---\na: 1\n---\n\n%%\nhidden\n%%\n\n- [ ] task";
    const { fragment } = await renderNote(source, "Notes/A.md", deps, { interactive: true });
    expect(fragment.querySelector<HTMLElement>(".task-box")?.dataset.taskLine).toBe("8");
  });

  it("does not make a box written as HTML in the note clickable", async () => {
    const source = '<button class="task-box" data-task-line="0">x</button>\n\n- [ ] real';
    const { fragment } = await renderNote(source, "Notes/A.md", deps, { interactive: true });
    expect([...fragment.querySelectorAll("[data-task-line]")]).toHaveLength(1);
    expect(fragment.querySelector("li button.task-box")?.hasAttribute("data-task-line")).toBe(true);
  });

  it("makes no box clickable outside the reading view", async () => {
    const { div } = await render("- [ ] task");
    expect(div.querySelector("button.task-box")).toBeNull();
  });

  it("keeps a list whole around a multi-line comment", async () => {
    const { div } = await render("- a\n%%\nhidden\n%%\n- b");
    expect(div.querySelectorAll("ul")).toHaveLength(1);
    expect(div.querySelectorAll("li")).toHaveLength(2);
    expect(div.textContent).not.toContain("hidden");
  });

  it("leaves brackets alone anywhere but the start of an item", async () => {
    const { div } = await render("- a [ ] b\n- [x](https://example.com)\n\n[ ] paragraph");
    expect(div.querySelector(".task-box")).toBeNull();
    expect(div.textContent).toContain("a [ ] b");
    expect(div.textContent).toContain("[ ] paragraph");
  });
});
