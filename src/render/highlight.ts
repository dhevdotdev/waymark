import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

const LANGS: Record<string, () => Promise<unknown>> = {
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  properties: () => import("shiki/langs/ini.mjs"),
  protobuf: () => import("shiki/langs/proto.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  makefile: () => import("shiki/langs/make.mjs"),
  dockerfile: () => import("shiki/langs/docker.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  "c++": "cpp",
  hpp: "cpp",
  yml: "yaml",
  kt: "kotlin",
  py: "python",
  proto: "protobuf",
  gradle: "groovy",
  make: "makefile",
  docker: "dockerfile",
  ini: "properties",
  rs: "rust",
};

const THEMES: Record<string, () => Promise<unknown>> = {
  "catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
  "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
  "rose-pine-dawn": () => import("shiki/themes/rose-pine-dawn.mjs"),
  "rose-pine-moon": () => import("shiki/themes/rose-pine-moon.mjs"),
  "gruvbox-light-medium": () => import("shiki/themes/gruvbox-light-medium.mjs"),
  "gruvbox-dark-medium": () => import("shiki/themes/gruvbox-dark-medium.mjs"),
  "everforest-light": () => import("shiki/themes/everforest-light.mjs"),
  "everforest-dark": () => import("shiki/themes/everforest-dark.mjs"),
  "vitesse-light": () => import("shiki/themes/vitesse-light.mjs"),
  "vitesse-dark": () => import("shiki/themes/vitesse-dark.mjs"),
};

export class Highlighter {
  private core: HighlighterCore | null = null;
  private loaded = new Set<string>();
  private loadedThemes = new Set<string>();
  private themes = { light: "catppuccin-latte", dark: "catppuccin-mocha" };

  async init(): Promise<void> {
    this.core = await createHighlighterCore({
      themes: [],
      langs: [],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
    await this.setThemes(this.themes.light, this.themes.dark);
  }

  /** Code is highlighted for the active family's light and dark variants at once. */
  async setThemes(light: string, dark: string): Promise<void> {
    for (const name of [light, dark]) {
      if (this.loadedThemes.has(name) || !this.core) continue;
      const mod = (await THEMES[name]()) as { default: Parameters<HighlighterCore["loadTheme"]>[0] };
      await this.core.loadTheme(mod.default);
      this.loadedThemes.add(name);
    }
    this.themes = { light, dark };
  }

  /** Loads the grammars a note needs before its synchronous render pass. */
  async prepare(markdown: string): Promise<void> {
    const wanted = new Set<string>();
    for (const m of markdown.matchAll(/^\s*(?:```|~~~)\s*([\w+#-]+)/gm)) {
      const lang = canonical(m[1].toLowerCase());
      if (lang && !this.loaded.has(lang)) wanted.add(lang);
    }
    await Promise.all(
      [...wanted].map(async (lang) => {
        const mod = (await LANGS[lang]()) as { default: Parameters<HighlighterCore["loadLanguage"]>[0] };
        await this.core!.loadLanguage(mod.default);
        this.loaded.add(lang);
      }),
    );
  }

  highlight = (code: string, lang: string): string | null => {
    const id = canonical(lang);
    if (!this.core || !id || !this.loaded.has(id)) return null;
    const grammar =
      id === "properties"
        ? "ini"
        : id === "protobuf"
          ? "proto"
          : id === "makefile"
            ? "make"
            : id === "dockerfile"
              ? "docker"
              : id;
    return this.core.codeToHtml(code, {
      lang: grammar,
      themes: this.themes,
      defaultColor: false,
    });
  };
}

function canonical(lang: string): string | null {
  const id = ALIASES[lang] ?? lang;
  return id in LANGS ? id : null;
}
