import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/vault/**",
        "src/render/**",
        "src/ui/commands.ts",
        "src/ui/sync-status.ts",
        "src/ui/fuzzy.ts",
        "src/prefs.ts",
      ],
      // These need a real browser engine and are exercised by tests/e2e.
      exclude: ["src/render/diagrams.ts", "src/render/highlight.ts", "src/vault/source.ts"],
      reporter: ["text-summary"],
      thresholds: { statements: 75, branches: 65, functions: 75, lines: 75 },
    },
  },
});
