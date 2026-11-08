import katex from "katex";
import markdownit, { type MarkdownIt, type StateCore, type StateInline, type Token } from "markdown-it";
import mark from "markdown-it-mark";
import texmath from "markdown-it-texmath";
import { headingId, headingKey, type VaultIndex } from "../vault/index";

export interface RenderEnv {
  [key: string]: unknown;
  index: VaultIndex;
  currentPath: string;
  assetUrl: (path: string) => string;
  highlight: (code: string, lang: string) => string | null;
  headings: { level: number; text: string; id: string }[];
}

const CALLOUT_ALIASES: Record<string, string> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  caution: "warning",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export function createMarkdown(): MarkdownIt {
  const md = markdownit({ html: true, linkify: true, typographer: false });
  md.use(mark);
  md.use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: { throwOnError: false, output: "htmlAndMathml", trust: false },
  });
  md.inline.ruler.before("link", "wikilink", wikilinkRule);
  md.core.ruler.after("block", "callouts", calloutRule);
  md.core.ruler.push("heading_ids", headingRule);

  md.renderer.rules.wikilink = (tokens, i, _opts, env) => renderWikilink(md, tokens[i], env as unknown as RenderEnv);
  md.renderer.rules.fence = (tokens, i, _opts, env) => renderFence(md, tokens[i], env as unknown as RenderEnv);
  md.renderer.rules.blockquote_open = (tokens, i, opts, _env, self) => {
    const c = tokens[i].meta?.callout as Callout | undefined;
    if (!c) return self.renderToken(tokens, i, opts);
    const title = c.title ? md.renderInline(c.title, _env) : escapeAttr(c.label);
    const kind = escapeAttr(c.kind);
    const head = c.fold
      ? `<button class="callout-title" type="button" aria-expanded="${c.fold === "+"}">`
      : `<div class="callout-title">`;
    const headEnd = c.fold
      ? `<svg class="callout-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg></button>`
      : `</div>`;
    return `<div class="callout" data-callout="${kind}" data-type="${escapeAttr(c.type)}"${c.fold ? ` data-fold="${c.fold === "+" ? "open" : "closed"}"` : ""}>${head}<span class="callout-icon" aria-hidden="true"></span><span class="callout-label">${title}</span>${headEnd}<div class="callout-body"><div class="callout-content">`;
  };
  md.renderer.rules.blockquote_close = (tokens, i, opts, _env, self) => {
    const open = findOpen(tokens, i, "blockquote_open");
    return open?.meta?.callout ? `</div></div></div>` : self.renderToken(tokens, i, opts);
  };
  md.renderer.rules.table_open = () => `<div class="table-wrap" tabindex="0"><table>`;
  md.renderer.rules.table_close = () => `</table></div>`;

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, i, opts, rawEnv, self) => {
    const env = rawEnv as unknown as RenderEnv;
    const src = String(tokens[i].attrGet("src") ?? "");
    if (/^(https?:)?\/\//i.test(src)) {
      const alt = escapeAttr(tokens[i].content || src);
      return `<span class="remote-image" data-src="${escapeAttr(src)}" title="Remote image not loaded">${alt}</span>`;
    }
    const res = env.index.resolve(decodeURIComponent(src.split("/").pop() ?? src), false);
    if (res.kind === "found") tokens[i].attrSet("src", env.assetUrl(res.path));
    tokens[i].attrSet("loading", "lazy");
    return defaultImage(tokens, i, opts, rawEnv, self);
  };

  const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    const href = String(tokens[i].attrGet("href") ?? "");
    if (/^https?:/i.test(href)) {
      tokens[i].attrSet("class", "external");
      tokens[i].attrSet("data-external", "");
    }
    return defaultLink(tokens, i, opts, env, self);
  };
  return md;
}

function findOpen(tokens: Token[], closeIndex: number, type: string): Token | undefined {
  const level = tokens[closeIndex].level;
  for (let j = closeIndex - 1; j >= 0; j--) if (tokens[j].type === type && tokens[j].level === level) return tokens[j];
  return undefined;
}

interface Callout {
  type: string;
  kind: string;
  label: string;
  title: string;
  fold: "" | "+" | "-";
}

function calloutRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    const inline = tokens[i + 2];
    if (tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;
    const m = /^\[!([A-Za-z0-9_-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/.exec(inline.content);
    if (!m) continue;
    const type = m[1].toLowerCase();
    tokens[i].meta = {
      callout: {
        type,
        kind: CALLOUT_ALIASES[type] ?? type,
        label: type.charAt(0).toUpperCase() + type.slice(1),
        title: m[3].trim(),
        fold: m[2] as Callout["fold"],
      } satisfies Callout,
    };
    const rest = inline.content.slice(m[0].length);
    if (rest.trim()) {
      inline.content = rest;
    } else {
      tokens.splice(i + 1, 3);
    }
  }
}

function headingRule(state: StateCore): void {
  const env = state.env as unknown as RenderEnv;
  const seen = new Map<string, number>();
  for (let i = 0; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    if (t.type !== "heading_open") continue;
    const text = state.tokens[i + 1].content;
    let id = headingId(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += `-${n}`;
    t.attrSet("id", id);
    t.attrSet("data-key", headingKey(text));
    env.headings?.push({ level: Number(t.tag.slice(1)), text, id });
  }
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let pos = state.pos;
  const embed = src.charCodeAt(pos) === 0x21; /* ! */
  if (embed) pos++;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const end = src.indexOf("]]", pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner || inner.includes("\n") || inner.includes("[[")) return false;
  if (!silent) {
    const token = state.push("wikilink", "", 0);
    const pipe = inner.indexOf("|");
    const ref = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const hash = ref.indexOf("#");
    token.meta = {
      embed,
      target: (hash >= 0 ? ref.slice(0, hash) : ref).trim(),
      anchor: hash >= 0 ? ref.slice(hash + 1).trim() : "",
      alias: pipe >= 0 ? inner.slice(pipe + 1).trim() : "",
    };
  }
  state.pos = end + 2;
  return true;
}

function renderWikilink(md: MarkdownIt, token: Token, env: RenderEnv): string {
  const { embed, target, anchor, alias } = token.meta as { embed: boolean; target: string; anchor: string; alias: string };
  const isAsset = /\.[a-z0-9]{2,5}$/i.test(target) && !/\.md$/i.test(target);

  if (embed && isAsset) {
    const res = env.index.resolve(target, false);
    if (res.kind !== "found") {
      return `<span class="embed-missing" title="${escapeAttr(target)} is not in the vault"><span class="embed-missing-icon" aria-hidden="true"></span>${escapeAttr(target)}</span>`;
    }
    const url = env.assetUrl(res.path);
    if (IMAGE_EXT.test(target)) {
      const size = /^(\d+)(?:x(\d+))?$/.exec(alias);
      const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ""}` : "";
      const alt = size ? target : alias || target;
      return `<img class="embed-image" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async"${dims}>`;
    }
    if (/\.pdf$/i.test(target)) {
      return `<figure class="embed-pdf"><iframe src="${escapeAttr(url)}#toolbar=0" title="${escapeAttr(target)}" sandbox></iframe><figcaption>${escapeAttr(target)}</figcaption></figure>`;
    }
    return `<a class="embed-file" href="${escapeAttr(url)}">${escapeAttr(target)}</a>`;
  }

  const label = alias || (target ? target + (anchor ? ` › ${anchor}` : "") : anchor);
  if (isAsset) {
    const res = env.index.resolve(target, false);
    if (res.kind !== "found")
      return `<span class="wikilink is-missing" title="${escapeAttr(target)} is not in the vault">${md.utils.escapeHtml(label)}</span>`;
    return `<a class="attachment-link" href="${escapeAttr(env.assetUrl(res.path))}" data-attachment="${escapeAttr(res.path)}">${md.utils.escapeHtml(label)}</a>`;
  }
  const anchorAttr = anchor ? ` data-anchor="${escapeAttr(anchor)}"` : "";
  if (!target) {
    return `<a class="wikilink" href="#" data-path="${escapeAttr(env.currentPath)}"${anchorAttr}>${md.utils.escapeHtml(label)}</a>`;
  }
  const res = env.index.resolve(target, true);
  if (res.kind === "found") {
    const note = embed ? ` data-embed` : "";
    return `<a class="wikilink" href="#" data-path="${escapeAttr(res.path)}"${anchorAttr}${note}>${md.utils.escapeHtml(label)}</a>`;
  }
  if (res.kind === "ambiguous") {
    return `<a class="wikilink is-ambiguous" href="#" data-candidates="${escapeAttr(JSON.stringify(res.candidates))}"${anchorAttr} title="${res.candidates.length} notes share this name">${md.utils.escapeHtml(label)}</a>`;
  }
  return `<span class="wikilink is-missing" title="No note named “${escapeAttr(target)}”">${md.utils.escapeHtml(label)}</span>`;
}

function renderFence(md: MarkdownIt, token: Token, env: RenderEnv): string {
  const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
  const code = token.content.replace(/\n$/, "");
  if (lang === "mermaid") {
    return `<figure class="diagram" data-diagram="mermaid"><pre class="diagram-source">${md.utils.escapeHtml(code)}</pre></figure>`;
  }
  const highlighted = lang ? env.highlight(code, lang) : null;
  const body = highlighted ?? `<pre class="shiki plain"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  const lines = code.split("\n").length;
  const textArt = /[\u2500-\u257F]/.test(code) ? " is-text-art" : "";
  return `<div class="code${textArt}" data-lang="${escapeAttr(lang)}" data-lines="${lines}"><div class="code-bar"><button class="code-copy" type="button" aria-label="Copy code"><span>Copy</span></button></div>${body}</div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
