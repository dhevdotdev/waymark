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

export interface RenderContext {
  index: VaultIndex;
  highlighter: Highlighter;
  assetUrl: (path: string) => string;
}

export async function renderNote(
  source: string,
  path: string,
  deps: RenderContext,
  options: { interactive?: boolean } = {},
): Promise<RenderedNote> {
  const t0 = performance.now();
  const { data, body, offset } = parseFrontmatter(source);
  const text = stripComments(body);
  /* Marks the task boxes this render made, so a box written as HTML in the note cannot act as one. */
  const taskNonce = crypto.randomUUID();
  const g0 = performance.now();
  await deps.highlighter.prepare(text);
  const grammarMs = performance.now() - g0;
  const env: RenderEnv = {
    index: deps.index,
    currentPath: path,
    assetUrl: deps.assetUrl,
    highlight: deps.highlighter.highlight,
    headings: [],
    taskLineOffset: options.interactive ? offset : null,
    taskNonce,
  };
  const html = md.render(text, env as never);
  const fragment = sanitize(html);
  for (const box of fragment.querySelectorAll<HTMLElement>("[data-task-line]")) {
    const [nonce, line] = box.dataset.taskLine!.split(":");
    if (nonce === taskNonce) box.dataset.taskLine = line;
    else box.removeAttribute("data-task-line");
  }
  for (const list of fragment.querySelectorAll<HTMLOListElement>("ol[start]")) {
    const start = Number(list.getAttribute("start"));
    if (Number.isInteger(start)) list.style.setProperty("--list-start", String(start - 1));
  }
  return { fragment, headings: env.headings, frontmatter: data, ms: performance.now() - t0 - grammarMs, grammarMs };
}
