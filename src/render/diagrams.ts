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
  const node = role("var(--paper)");
  const border = role("var(--rule-strong)");
  const accent = role("var(--accent)");
  const cluster = role("color-mix(in oklab, var(--p-surface0) 40%, var(--code-bg))");
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

/** Renders every pending Mermaid figure under `root` with the current theme. */
export async function renderDiagrams(root: ParentNode): Promise<void> {
  const figures = [...root.querySelectorAll<HTMLElement>("figure.diagram[data-diagram=mermaid]")];
  if (!figures.length) return;
  for (const f of figures) f.classList.add("is-pending");
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
    const source = figure.querySelector(".diagram-source")?.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${++seq}`, source);
      figure.querySelector(".diagram-svg")?.remove();
      figure.querySelector(".diagram-expand")?.remove();
      const holder = document.createElement("div");
      holder.className = "diagram-svg";
      holder.innerHTML = bindColours(svg);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "diagram-expand";
      button.setAttribute("aria-label", "Enlarge diagram");
      button.innerHTML = EXPAND_ICON;
      figure.append(holder, button);
      figure.classList.remove("is-pending", "is-error");
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
  }
}
