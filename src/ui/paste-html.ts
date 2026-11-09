const SKIPPED = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "CANVAS",
  "HEAD",
  "META",
  "LINK",
  "TITLE",
]);
const BLOCKS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CENTER",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "UL",
]);
const BLOCK_SELECTOR = [...BLOCKS].join(",").toLowerCase();
const FORMATTING =
  "h1,h2,h3,h4,h5,h6,strong,b,em,i,a,ul,ol,code,pre,blockquote,table,img,del,s,strike,span[style*=font-weight],span[style*=italic]";
const CODE_EDITOR_TYPES = /^(vscode-editor-data|application\/vnd\.code|application\/x-jetbrains|application\/x-sublime)/i;
const MONOSPACE = /monospace|menlo|consolas|courier|monaco|sf mono|jetbrains|fira code|white-space:\s*pre/i;
const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^https?:/i;

const collapse = (text: string) => text.replace(/[ \t\r\n\f]+/g, " ");

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*`])/g, "\\$1")
    .replace(/(^|[^\w])_(?=\S)/g, "$1\\_")
    .replace(/\[(?=\[)/g, "\\[")
    .replace(/<(?=[a-zA-Z/!])/g, "\\<");
}

/** Puts a mark around text, leaving the spaces at its edges outside, since Markdown ignores marks that touch a space. */
function wrap(text: string, mark: string): string {
  const inner = text.trim();
  if (!inner) return text;
  return `${text.slice(0, text.indexOf(inner[0]))}${mark}${inner}${mark}${text.slice(text.lastIndexOf(inner.at(-1)!) + 1)}`;
}

function codeSpan(text: string): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return "";
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(longest + 1);
  return longest ? `${ticks} ${value} ${ticks}` : `${ticks}${value}${ticks}`;
}

const destination = (url: string) => (/[\s()]/.test(url) ? `<${url.replace(/[<>]/g, "")}>` : url);

function inlineElement(element: HTMLElement): string {
  const tag = element.tagName;
  const inner = () => inlines(element);
  const style = element.getAttribute("style") ?? "";
  switch (tag) {
    case "BR":
      return "\n";
    case "STRONG":
      return wrap(inner(), "**");
    case "B":
      return /font-weight:\s*(normal|400)/i.test(style) ? inner() : wrap(inner(), "**");
    case "EM":
    case "I":
      return wrap(inner(), "*");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrap(inner(), "~~");
    case "CODE":
    case "KBD":
    case "SAMP":
    case "TT":
      return codeSpan(element.textContent ?? "");
    case "A": {
      const href = element.getAttribute("href") ?? "";
      const label = inner().trim();
      if (!SAFE_LINK.test(href)) return inner();
      return label ? `[${label.replace(/\n/g, " ")}](${destination(href)})` : "";
    }
    case "IMG": {
      const src = element.getAttribute("src") ?? "";
      const alt = element.getAttribute("alt")?.trim() ?? "";
      return SAFE_IMAGE.test(src) ? `[${alt || "image"}](${destination(src)})` : alt;
    }
    case "INPUT":
      return element.getAttribute("type") === "checkbox"
        ? `[${(element as HTMLInputElement).hasAttribute("checked") ? "x" : " "}] `
        : "";
    case "SPAN": {
      let text = inner();
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style)) text = wrap(text, "**");
      if (/font-style:\s*italic/i.test(style)) text = wrap(text, "*");
      return text;
    }
    default:
      return inner();
  }
}

function inlines(parent: Node): string {
  let out = "";
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += escapeText(collapse(child.textContent ?? ""));
    else if (child.nodeType === Node.ELEMENT_NODE && !SKIPPED.has((child as Element).tagName.toUpperCase()))
      out += inlineElement(child as HTMLElement);
  }
  return out;
}

const indent = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");

function escapeLineStart(line: string): string {
  return line.replace(/^(\s*)(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, "$1\\$2");
}

function paragraph(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(escapeLineStart)
    .join("\n");
}

function fenceFor(element: HTMLElement): string {
  const code = element.querySelector("code") ?? element;
  const text = (code.textContent ?? "").replace(/\n$/, "");
  const language =
    /(?:language-|lang-|highlight-source-)([\w+#-]+)/.exec(
      `${code.className} ${element.className} ${element.parentElement?.className ?? ""}`,
    )?.[1] ?? "";
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

function list(element: HTMLElement): string {
  const ordered = element.tagName === "OL";
  let number = Number(element.getAttribute("start") ?? 1);
  const items: string[] = [];
  for (const item of element.children) {
    if (item.tagName !== "LI") {
      if (["UL", "OL"].includes(item.tagName)) items.push(indent(list(item as HTMLElement), "  "));
      continue;
    }
    const marker = ordered ? `${number++}. ` : "- ";
    const body = blocks(item).join("\n").trim();
    items.push(`${marker}${indent(body, " ".repeat(marker.length)).trimStart()}`);
  }
  return items.join("\n");
}

function cellText(cell: Element): string {
  return inlines(cell)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function table(element: HTMLElement): string {
  const rows = [...element.querySelectorAll("tr")].filter((row) => row.closest("table") === element);
  if (!rows.length) return "";
  const cells = rows.map((row) => [...row.children].filter((c) => ["TD", "TH"].includes(c.tagName)).map(cellText));
  const width = Math.max(...cells.map((row) => row.length));
  if (!width) return "";
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [line(cells[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...cells.slice(1).map(line)].join("\n");
}

function block(element: HTMLElement): string[] {
  const tag = element.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const text = inlines(element)
      .replace(/\s*\n\s*/g, " ")
      .trim();
    return text ? [`${"#".repeat(Number(tag[1]))} ${text}`] : [];
  }
  if (tag === "UL" || tag === "OL") return [list(element)].filter(Boolean);
  if (tag === "PRE") return [fenceFor(element)];
  if (tag === "BLOCKQUOTE") {
    const body = blocks(element).join("\n\n");
    return body
      ? [
          body
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n"),
        ]
      : [];
  }
  if (tag === "TABLE") return [table(element)].filter(Boolean);
  if (tag === "HR") return ["---"];
  return blocks(element);
}

/** Splits an element's children into blocks, gathering runs of inline content into paragraphs. */
function blocks(parent: Element): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    const text = paragraph(run);
    if (text) out.push(text);
    run = "";
  };
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) run += escapeText(collapse(child.textContent ?? ""));
    else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as HTMLElement;
      if (SKIPPED.has(element.tagName.toUpperCase())) continue;
      if (BLOCKS.has(element.tagName) && element.tagName !== "LI") {
        flush();
        out.push(...block(element));
      } else if (element.querySelector(BLOCK_SELECTOR)) {
        flush();
        out.push(...blocks(element));
      } else run += inlineElement(element);
    }
  }
  flush();
  return out;
}

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** Copies from code editors arrive as styled HTML, which must never become spans or formatting. */
export function isCodeEditorCopy(types: readonly string[], html: string): boolean {
  if (types.some((type) => CODE_EDITOR_TYPES.test(type))) return true;
  const doc = parseHtml(html);
  const structural = doc.body.querySelector(":not(div, pre, span, br, code, p, font)");
  if (structural) return false;
  const styled = doc.body.querySelector("[style]")?.getAttribute("style") ?? "";
  const sheet = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("");
  return MONOSPACE.test(styled) || MONOSPACE.test(sheet);
}

/** Markdown for pasted HTML, or null when the HTML adds nothing to its plain text. A parsed document runs no scripts and loads no images. */
export function htmlToMarkdown(html: string): string | null {
  const doc = parseHtml(html);
  if (!doc.body.querySelector(FORMATTING)) return null;
  const text = blocks(doc.body)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
