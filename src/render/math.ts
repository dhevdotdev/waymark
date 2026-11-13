import type { KatexOptions } from "katex";

type Katex = typeof import("katex").default;

export const KATEX_OPTIONS = { throwOnError: false, output: "htmlAndMathml", trust: false } as const;

let katex: Katex | null = null;
let loading: Promise<boolean> | null = null;
let missed = false;

/** KaTeX is a chunk of the app itself, so loading it never reaches the network. Most notes have no math, so startup leaves it out. */
export function loadMath(): Promise<boolean> {
  loading ??= import("katex").then(
    (module) => {
      katex = module.default;
      return true;
    },
    (error: unknown) => {
      console.warn("Math not loaded", error);
      loading = null;
      return false;
    },
  );
  return loading;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The engine markdown-it-texmath draws with. Until KaTeX has loaded it records the miss and shows the source. */
export const mathEngine = {
  renderToString(tex: string, options: KatexOptions): string {
    if (katex) return katex.renderToString(tex, options);
    missed = true;
    void loadMath();
    return escapeHtml(tex);
  },
};

/** Runs a synchronous render, and once more after KaTeX loads if the first pass met math, so math is drawn in the note's first paint. */
export async function withMath<T>(render: () => T): Promise<T> {
  missed = false;
  const first = render();
  if (!missed) return first;
  return (await loadMath()) ? render() : first;
}

/** Draws into `element`, or returns false while KaTeX is not loaded. */
export function drawMath(element: HTMLElement, tex: string, display: boolean): boolean {
  if (!katex) return false;
  katex.render(tex, element, { ...KATEX_OPTIONS, displayMode: display });
  return true;
}
