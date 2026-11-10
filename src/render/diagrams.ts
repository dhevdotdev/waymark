import type { MermaidConfig } from "mermaid";

type Mermaid = typeof import("mermaid").default;
let mermaidPromise: Promise<Mermaid> | null = null;
let seq = 0;

function load(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

/*
 * Diagrams follow the theme live. Mermaid is given unique placeholder colours,
 * and each placeholder in the SVG is then replaced with the CSS variable it
 * stands for, so switching theme or appearance repaints diagrams through CSS
 * with no re-render.
 */
const ROLES: Record<string, string> = {
  "#010101": "var(--code-bg)",
  "#020202": "var(--ink)",
  "#030303": "var(--ink-3)",
  "#040404": "var(--paper)",
  "#050505": "var(--rule-strong)",
  "#060606": "var(--accent)",
  "#070707": "color-mix(in oklab, var(--p-surface0) 40%, var(--code-bg))",
};
const role = (css: string) => Object.keys(ROLES).find((k) => ROLES[k] === css)!;

function themeVariables(): MermaidConfig["themeVariables"] {
  const paper = role("var(--code-bg)");
  const ink = role("var(--ink)");
  const line = role("var(--ink-3)");
  const node = role("color-mix(in oklab, var(--p-surface0) 55%, var(--code-bg))");
  const border = role("var(--ink-3)");
  const accent = role("var(--accent)");
  const cluster = role("color-mix(in oklab, var(--p-surface0) 25%, var(--code-bg))");
  return {
    darkMode: false,
    background: paper,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim(),
    fontSize: "13px",
    primaryColor: node,
    primaryTextColor: ink,
    primaryBorderColor: border,
    secondaryColor: cluster,
    secondaryTextColor: ink,
    secondaryBorderColor: border,
    tertiaryColor: cluster,
    tertiaryTextColor: ink,
    tertiaryBorderColor: border,
    lineColor: line,
    textColor: ink,
    mainBkg: node,
    secondBkg: cluster,
    nodeBorder: border,
    nodeTextColor: ink,
    clusterBkg: cluster,
    clusterBorder: border,
    edgeLabelBackground: paper,
    titleColor: ink,
    actorBkg: node,
    actorBorder: border,
    actorTextColor: ink,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: ink,
    noteBkgColor: cluster,
    noteTextColor: ink,
    noteBorderColor: border,
    activationBkgColor: cluster,
    activationBorderColor: border,
    labelBoxBkgColor: node,
    labelBoxBorderColor: border,
    labelTextColor: ink,
    loopTextColor: ink,
    sequenceNumberColor: node,
    pie1: accent,
    stateBkg: node,
    stateLabelColor: ink,
    compositeBackground: cluster,
    compositeTitleBackground: cluster,
    altBackground: cluster,
    errorBkgColor: cluster,
    errorTextColor: ink,
  };
}

/** Replaces placeholder colours (hex, or the rgb() form Mermaid sometimes emits) with theme variables. */
function bindColours(svg: string): string {
  let out = svg;
  for (const [hex, css] of Object.entries(ROLES)) {
    const n = parseInt(hex.slice(1, 3), 16);
    out = out
      .replaceAll(new RegExp(hex, "gi"), css)
      .replaceAll(new RegExp(`rgba?\\(\\s*${n}\\s*,\\s*${n}\\s*,\\s*${n}\\s*(,\\s*[0-9.]+\\s*)?\\)`, "g"), css);
  }
  return out;
}

const EXPAND_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>`;

const sourceOf = (figure: HTMLElement) => figure.querySelector(".diagram-source")?.textContent ?? "";

/** Drawn diagrams by source. Colours are theme variables, so one drawing holds for every theme. */
const drawn = new Map<string, string>();
const MAX_REMEMBERED = 200;

function remember(source: string, svg: string): void {
  drawn.set(source, svg);
  if (drawn.size > MAX_REMEMBERED) drawn.delete(drawn.keys().next().value!);
}

function place(figure: HTMLElement, svg: string): void {
  figure.querySelector(".diagram-svg")?.remove();
  figure.querySelector(".diagram-expand")?.remove();
  const holder = document.createElement("div");
  holder.className = "diagram-svg";
  holder.innerHTML = svg;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagram-expand";
  button.setAttribute("aria-label", "Enlarge diagram");
  button.innerHTML = EXPAND_ICON;
  figure.append(holder, button);
  figure.classList.remove("is-pending", "is-error");
}

const HEIGHTS_KEY = "waymark.diagramHeights";
const MAX_HEIGHTS = 1000;

function loadHeights(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HEIGHTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** How tall each diagram last was, kept between launches so its space can be held before it is drawn again. */
const heights = loadHeights();

function fingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193);
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

function rememberHeight(source: string, height: number): void {
  heights[fingerprint(source)] = Math.round(height);
  const keys = Object.keys(heights);
  if (keys.length > MAX_HEIGHTS) delete heights[keys[0]];
  try {
    localStorage.setItem(HEIGHTS_KEY, JSON.stringify(heights));
  } catch {
    /* Only a convenience: the next view estimates instead. */
  }
}

/** Roughly how tall a diagram will be, from its kind and length. Fitted to drawn diagrams, so the page moves less when the real one arrives. */
function estimateDiagramHeight(source: string): number {
  const lines = source.trim().split("\n").length;
  const head = source.trim().split("\n", 1)[0];
  let height = 250 + 55 * lines;
  if (/^sequenceDiagram/.test(head)) height = 340 + 7 * lines;
  else if (/^(?:graph|flowchart)\s+(?:LR|RL)/.test(head)) height = 35 * lines;
  return Math.min(Math.max(height, 100), 900);
}

/** Renders every pending Mermaid figure under `root` with the current theme. One seen before is drawn at once. */
export async function renderDiagrams(root: ParentNode): Promise<void> {
  const figures = [...root.querySelectorAll<HTMLElement>("figure.diagram[data-diagram=mermaid]")].filter((figure) => {
    const svg = drawn.get(sourceOf(figure));
    if (svg) place(figure, svg);
    return !svg;
  });
  if (!figures.length) return;
  for (const f of figures) {
    f.classList.add("is-pending");
    f.style.minBlockSize = `${heights[fingerprint(sourceOf(f))] ?? estimateDiagramHeight(sourceOf(f))}px`;
  }
  /* Mermaid measures label text while laying out; measuring before the UI face loads clips labels. */
  const [mermaid] = await Promise.all([load(), document.fonts.load('13px "Inter Variable"'), document.fonts.ready]);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
    flowchart: { curve: "basis", padding: 12, nodeSpacing: 36, rankSpacing: 44, htmlLabels: true },
    sequence: { mirrorActors: false, actorMargin: 48 },
  });
  for (const figure of figures) {
    const source = sourceOf(figure);
    try {
      const { svg } = await mermaid.render(`mmd-${++seq}`, source);
      const themed = bindColours(svg);
      remember(source, themed);
      place(figure, themed);
      figure.style.minBlockSize = "";
      if (figure.isConnected) rememberHeight(source, figure.getBoundingClientRect().height);
    } catch (err) {
      figure.classList.remove("is-pending");
      figure.classList.add("is-error");
      if (!figure.querySelector(".diagram-error")) {
        const note = document.createElement("div");
        note.className = "diagram-error";
        note.textContent = `Diagram could not be drawn: ${(err as Error).message.split("\n")[0]}`;
        figure.prepend(note);
      }
    }
    figure.style.minBlockSize = "";
  }
}
