/**
 * A small, curated set of developer themes. Each family has a light and a dark
 * variant; Waymark follows the system appearance unless one is pinned.
 * A variant supplies a raw palette mapped onto Catppuccin's role names plus
 * the sheet colour and accent; every component reads semantic tokens built
 * from these in tokens.css.
 */
export type Scheme = "light" | "dark";

interface Variant {
  id: string;
  label: string;
  code: string;
  paper: string;
  accent: string;
  ink?: string;
  tint: string;
  p: Record<string, string>;
}

export interface Family {
  id: string;
  label: string;
  light: Variant;
  dark: Variant;
}

const roles = (
  text: string, subtext1: string, subtext0: string, overlay2: string, overlay1: string, overlay0: string,
  surface2: string, surface1: string, surface0: string, base: string, mantle: string, crust: string,
  accents: Partial<Record<"rosewater" | "flamingo" | "pink" | "mauve" | "red" | "maroon" | "peach" | "yellow" | "green" | "teal" | "sky" | "sapphire" | "blue" | "lavender", string>>,
) => ({ text, subtext1, subtext0, overlay2, overlay1, overlay0, surface2, surface1, surface0, base, mantle, crust, ...accents });

export const FAMILIES: Family[] = [
  {
    id: "catppuccin",
    label: "Catppuccin",
    light: {
      id: "latte", label: "Latte", code: "catppuccin-latte", tint: "8%",
      paper: "color-mix(in oklab, #eff1f5 30%, white)", accent: "#8839ef", ink: "color-mix(in oklab, #4c4f69 88%, black)",
      p: roles("#4c4f69", "#5c5f77", "#6c6f85", "#7c7f93", "#8c8fa1", "#9ca0b0", "#acb0be", "#bcc0cc", "#ccd0da", "#eff1f5", "#e6e9ef", "#dce0e8", {
        rosewater: "#dc8a78", flamingo: "#dd7878", pink: "#ea76cb", mauve: "#8839ef", red: "#d20f39", maroon: "#e64553", peach: "#fe640b", yellow: "#df8e1d",
        green: "#40a02b", teal: "#179299", sky: "#04a5e5", sapphire: "#209fb5", blue: "#1e66f5", lavender: "#7287fd",
      }),
    },
    dark: {
      id: "mocha", label: "Mocha", code: "catppuccin-mocha", tint: "11%",
      paper: "#1e1e2e", accent: "#cba6f7",
      p: roles("#cdd6f4", "#bac2de", "#a6adc8", "#9399b2", "#7f849c", "#6c7086", "#585b70", "#45475a", "#313244", "#1e1e2e", "#181825", "#11111b", {
        rosewater: "#f5e0dc", flamingo: "#f2cdcd", pink: "#f5c2e7", mauve: "#cba6f7", red: "#f38ba8", maroon: "#eba0ac", peach: "#fab387", yellow: "#f9e2af",
        green: "#a6e3a1", teal: "#94e2d5", sky: "#89dceb", sapphire: "#74c7ec", blue: "#89b4fa", lavender: "#b4befe",
      }),
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    light: {
      id: "dawn", label: "Dawn", code: "rose-pine-dawn", tint: "9%",
      paper: "#fffaf3", accent: "#286983", ink: "color-mix(in oklab, #575279 78%, black)",
      p: roles("#575279", "#625d84", "#797593", "#8a85a0", "#9893a5", "#a8a3b3", "#cecacd", "#dfdad9", "#f2e9e1", "#faf4ed", "#f2e9e1", "#eae0d6", {
        rosewater: "#d7827e", flamingo: "#d7827e", pink: "#d7827e", mauve: "#907aa9", red: "#b4637a", maroon: "#b4637a", peach: "#d7827e", yellow: "#ea9d34",
        green: "#56949f", teal: "#907aa9", sky: "#56949f", sapphire: "#56949f", blue: "#286983", lavender: "#907aa9",
      }),
    },
    dark: {
      id: "moon", label: "Moon", code: "rose-pine-moon", tint: "12%",
      paper: "#232136", accent: "#c4a7e7",
      p: roles("#e0def4", "#c7c4e0", "#908caa", "#817e9c", "#6e6a86", "#5d5a76", "#56526e", "#44415a", "#393552", "#232136", "#1f1d30", "#1a1828", {
        rosewater: "#ea9a97", flamingo: "#ea9a97", pink: "#ea9a97", mauve: "#c4a7e7", red: "#eb6f92", maroon: "#eb6f92", peach: "#ea9a97", yellow: "#f6c177",
        green: "#9ccfd8", teal: "#c4a7e7", sky: "#9ccfd8", sapphire: "#3e8fb0", blue: "#3e8fb0", lavender: "#c4a7e7",
      }),
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    light: {
      id: "gruvbox-light", label: "Light", code: "gruvbox-light-medium", tint: "10%",
      paper: "color-mix(in oklab, #fbf1c7 70%, white)", accent: "#076678", ink: "color-mix(in oklab, #3c3836 90%, black)",
      p: roles("#3c3836", "#504945", "#665c54", "#7c6f64", "#928374", "#a89984", "#bdae93", "#d5c4a1", "#ebdbb2", "#fbf1c7", "#f2e5bc", "#ebdbb2", {
        rosewater: "#af3a03", flamingo: "#af3a03", pink: "#8f3f71", mauve: "#8f3f71", red: "#9d0006", maroon: "#9d0006", peach: "#af3a03", yellow: "#b57614",
        green: "#79740e", teal: "#427b58", sky: "#076678", sapphire: "#076678", blue: "#076678", lavender: "#8f3f71",
      }),
    },
    dark: {
      id: "gruvbox-dark", label: "Dark", code: "gruvbox-dark-medium", tint: "12%",
      paper: "#282828", accent: "#83a598",
      p: roles("#ebdbb2", "#d5c4a1", "#bdae93", "#a89984", "#928374", "#7c6f64", "#665c54", "#504945", "#3c3836", "#282828", "#1d2021", "#171919", {
        rosewater: "#fe8019", flamingo: "#fe8019", pink: "#d3869b", mauve: "#d3869b", red: "#fb4934", maroon: "#fb4934", peach: "#fe8019", yellow: "#fabd2f",
        green: "#b8bb26", teal: "#8ec07c", sky: "#83a598", sapphire: "#83a598", blue: "#83a598", lavender: "#d3869b",
      }),
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    light: {
      id: "everforest-light", label: "Light", code: "everforest-light", tint: "11%",
      paper: "color-mix(in oklab, #fdf6e3 60%, white)", accent: "color-mix(in oklab, #35a77c 72%, black)", ink: "color-mix(in oklab, #5c6a72 62%, black)",
      p: roles("#5c6a72", "#64737a", "#829181", "#829181", "#939f91", "#a6b0a0", "#bdc3af", "#e0dcc7", "#e6e2cc", "#fdf6e3", "#f4f0d9", "#efebd4", {
        rosewater: "#e66868", flamingo: "#e66868", pink: "#df69ba", mauve: "#df69ba", red: "#f85552", maroon: "#f85552", peach: "#f57d26", yellow: "#dfa000",
        green: "#8da101", teal: "#35a77c", sky: "#3a94c5", sapphire: "#3a94c5", blue: "#3a94c5", lavender: "#df69ba",
      }),
    },
    dark: {
      id: "everforest-dark", label: "Dark", code: "everforest-dark", tint: "12%",
      paper: "#2d353b", accent: "#a7c080",
      p: roles("#d3c6aa", "#c5b99f", "#9da9a0", "#9da9a0", "#859289", "#7a8478", "#56635f", "#4f585e", "#3d484d", "#2d353b", "#272e33", "#232a2e", {
        rosewater: "#e69875", flamingo: "#e67e80", pink: "#d699b6", mauve: "#d699b6", red: "#e67e80", maroon: "#e67e80", peach: "#e69875", yellow: "#dbbc7f",
        green: "#a7c080", teal: "#83c092", sky: "#7fbbb3", sapphire: "#7fbbb3", blue: "#7fbbb3", lavender: "#d699b6",
      }),
    },
  },
  {
    id: "ember",
    label: "Ember",
    light: {
      id: "ember-light", label: "Light", code: "vitesse-light", tint: "9%",
      paper: "#fbfaf7", accent: "#c2410c", ink: "#2b2926",
      p: roles("#2b2926", "#45423d", "#5f5b55", "#77736c", "#8e8a83", "#a5a19a", "#bcb8b1", "#d3cfc8", "#e6e2db", "#f5f3ee", "#efece6", "#e8e4dd", {
        rosewater: "#b45309", flamingo: "#b91c1c", pink: "#c0397a", mauve: "#7c3aed", red: "#c8321f", maroon: "#b3422f", peach: "#c2410c", yellow: "#a16207",
        green: "#4d7c0f", teal: "#0f766e", sky: "#0369a1", sapphire: "#0e7490", blue: "#1d4ed8", lavender: "#4f46e5",
      }),
    },
    dark: {
      id: "ember-dark", label: "Dark", code: "vitesse-dark", tint: "10%",
      paper: "#1c1b1a", accent: "#f0783c",
      p: roles("#e6e2dc", "#cfcac3", "#b4afa8", "#9c9790", "#847f79", "#6e6a64", "#54514d", "#413f3c", "#302e2c", "#1c1b1a", "#171615", "#131211", {
        rosewater: "#e8b4a0", flamingo: "#e89a8a", pink: "#e58fb0", mauve: "#b79ce0", red: "#e5695a", maroon: "#d9756b", peach: "#f0783c", yellow: "#e0b45c",
        green: "#9dbf6e", teal: "#6fc2ae", sky: "#78b9d8", sapphire: "#6aa8c8", blue: "#7aa2e3", lavender: "#a8aee8",
      }),
    },
  },
];

export function findFamily(id: string | undefined): Family {
  return FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];
}

export function applyTheme(family: Family, scheme: Scheme): Variant {
  const v = family[scheme];
  const root = document.documentElement;
  for (const [k, val] of Object.entries(v.p)) root.style.setProperty(`--p-${k}`, val);
  root.style.setProperty("--paper", v.paper);
  root.style.setProperty("--accent", v.accent);
  root.style.setProperty("--ink", v.ink ?? v.p.text);
  root.style.setProperty("--tint", v.tint);
  root.dataset.theme = v.id;
  root.dataset.scheme = scheme;
  root.style.colorScheme = scheme;
  return v;
}
