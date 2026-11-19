// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/app";
import type { Reader } from "../../src/ui/reader";

/** An open vault whose editor saves, or fails to save anywhere, when asked to close. */
function openVault(saves: boolean) {
  const calls: string[] = [];
  const reader = {
    spots: { record: () => calls.push("record place") },
    editing: {
      close: async () => {
        calls.push("save edit");
        return saves;
      },
    },
    persist: () => calls.push("persist tabs"),
  };
  const app = new App(document.createElement("div"));
  app.reader = reader as unknown as Reader;
  return { app, calls };
}

describe("switching vault", () => {
  it("saves the edit and where everything was before it opens another vault", async () => {
    const { app, calls } = openVault(true);
    await expect(app.openVault("/elsewhere")).rejects.toThrow();
    expect(calls).toEqual(["record place", "save edit", "persist tabs"]);
  });

  it("stays in the vault when the edit could not be saved anywhere", async () => {
    const { app, calls } = openVault(false);
    const opened = vi.fn();
    await app.openVault("/elsewhere").then(opened);
    expect(opened).toHaveBeenCalled();
    expect(calls).toEqual(["record place", "save edit"]);
  });
});
