// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToMarkdown, isCodeEditorCopy } from "../../src/ui/paste-html";

describe("htmlToMarkdown", () => {
  it("converts the usual blocks and marks", () => {
    expect(
      htmlToMarkdown(`<h2>Title</h2><p>Some <strong>bold</strong>, <em>italic</em>, <code>x()</code> and <a href="https://a.example/b">a link</a>.</p>
<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol start="3"><li>c</li></ol><blockquote><p>said</p></blockquote>`),
    ).toBe(
      "## Title\n\nSome **bold**, *italic*, `x()` and [a link](https://a.example/b).\n\n- one\n  - nested\n- two\n\n3. c\n\n> said",
    );
  });

  it("keeps code blocks verbatim with their language", () => {
    expect(htmlToMarkdown('<pre><code class="language-js">if (a &lt; b) {\n  x*y;\n}\n</code></pre>')).toBe(
      "```js\nif (a < b) {\n  x*y;\n}\n```",
    );
  });

  it("makes a longer fence when the code holds one", () => {
    expect(htmlToMarkdown("<h1>a</h1><pre>```\nx\n```</pre>")).toBe("# a\n\n````\n```\nx\n```\n````");
  });

  it("builds tables and escapes their pipes", () => {
    expect(htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1|2</td><td><b>x</b></td></tr></table>")).toBe(
      "| A | B |\n| --- | --- |\n| 1\\|2 | **x** |",
    );
  });

  it("strips scripts, styles and comments", () => {
    const md = htmlToMarkdown('<!-- hidden --><style>p{color:red}</style><script>alert(1)</script><h1 onclick="x()">Kept</h1>');
    expect(md).toBe("# Kept");
  });

  it("turns remote images into plain links and never keeps an embed", () => {
    expect(htmlToMarkdown('<h1>t</h1><img src="https://e.example/a.png" alt="A chart">')).toBe(
      "# t\n\n[A chart](https://e.example/a.png)",
    );
    expect(htmlToMarkdown('<h1>t</h1><img src="data:image/png;base64,AAAA">')).toBe("# t");
  });

  it("drops links that are not safe to follow", () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe("click");
    expect(htmlToMarkdown('<a href="/relative">rel</a>')).toBe("rel");
  });

  it("does not let pasted text become formatting or a wikilink", () => {
    expect(htmlToMarkdown("<h1>x</h1><p>2 * 3 and [[not a link]] and &lt;div&gt; and snake_case</p>")).toBe(
      "# x\n\n2 \\* 3 and \\[[not a link]] and \\<div> and snake_case",
    );
  });

  it("reads bold and italic written as styles", () => {
    expect(htmlToMarkdown('<p><span style="font-weight:700">b</span> <span style="font-style:italic">i</span></p>')).toBe(
      "**b** *i*",
    );
    expect(htmlToMarkdown('<b style="font-weight:normal"><h2>Doc</h2></b>')).toBe("## Doc");
  });

  it("returns null when the HTML adds nothing", () => {
    expect(htmlToMarkdown("<p>just text</p>")).toBeNull();
    expect(htmlToMarkdown("<div>plain</div>")).toBeNull();
  });
});

describe("isCodeEditorCopy", () => {
  it("recognises the clipboard types editors add", () => {
    expect(isCodeEditorCopy(["text/plain", "text/html", "vscode-editor-data"], "<b>x</b>")).toBe(true);
  });

  it("recognises styled monospace with no document structure", () => {
    expect(
      isCodeEditorCopy(
        ["text/html"],
        `<pre style="font-family:'JetBrains Mono',monospace;"><span style="color:#a9b7c6">x</span></pre>`,
      ),
    ).toBe(true);
    expect(
      isCodeEditorCopy(["text/html"], `<div style="font-family: Menlo; white-space: pre;"><div><span>x</span></div></div>`),
    ).toBe(true);
    expect(
      isCodeEditorCopy(["text/html"], `<style>p.p1 {font: 12px Menlo}</style><p class="p1"><span class="s1">x</span></p>`),
    ).toBe(true);
  });

  it("leaves real documents alone", () => {
    expect(isCodeEditorCopy(["text/html"], "<h1>Title</h1><pre>code</pre>")).toBe(false);
    expect(isCodeEditorCopy(["text/html"], '<p style="font-family: Georgia">prose</p>')).toBe(false);
  });
});
