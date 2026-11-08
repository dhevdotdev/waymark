import { parseFrontmatter } from "../vault/frontmatter";
import type { VaultIndex } from "../vault/index";
import { stripComments } from "./comments";
import type { Highlighter } from "./highlight";
import { createMarkdown, type RenderEnv } from "./markdown";
import { sanitize } from "./sanitize";

const md = createMarkdown();

export interface RenderedNote {
  fragment: DocumentFragment;
  headings: RenderEnv["headings"];
  frontmatter: Record<string, string | string[]>;
  /** Markdown-to-DOM time, excluding one-time grammar loading. */
  ms: number;
  grammarMs: number;
}

export async function renderNote(
  source: string,
  path: string,
  deps: { index: VaultIndex; highlighter: Highlighter; assetUrl: (p: string) => string },
): Promise<RenderedNote> {
  const t0 = performance.now();
  const { data, body } = parseFrontmatter(source);
  const text = stripComments(body);
  const g0 = performance.now();
  await deps.highlighter.prepare(text);
  const grammarMs = performance.now() - g0;
  const env: RenderEnv = {
    index: deps.index,
    currentPath: path,
    assetUrl: deps.assetUrl,
    highlight: deps.highlighter.highlight,
    headings: [],
  };
  const html = md.render(text, env as never);
  const fragment = sanitize(html);
  for (const list of fragment.querySelectorAll<HTMLOListElement>("ol[start]")) {
    const start = Number(list.getAttribute("start"));
    if (Number.isInteger(start)) list.style.setProperty("--list-start", String(start - 1));
  }
  return { fragment, headings: env.headings, frontmatter: data, ms: performance.now() - t0 - grammarMs, grammarMs };
}
