// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PrefStore } from "../../src/prefs";

const KEY = "folio.prefs";
const load = async (saved: unknown) => {
  localStorage.setItem(KEY, JSON.stringify(saved));
  const store = new PrefStore();
  await store.load();
  return store.value;
};

describe("PrefStore.load", () => {
  beforeEach(() => localStorage.clear());

  it("keeps valid saved values", async () => {
    expect((await load({ sound: false, recentVaults: ["/a"] })).recentVaults).toEqual(["/a"]);
  });

  it("falls back per key when a saved value has the wrong shape", async () => {
    const prefs = await load({ recentVaults: "not a list", sidebarWidth: "wide", sound: false });
    expect(prefs.recentVaults).toEqual([]);
    expect(prefs.sidebarWidth).toBe(268);
    expect(prefs.sound).toBe(false);
  });

  it("rejects an unknown enum value", async () => {
    expect((await load({ appearance: "neon", railPane: "elsewhere" })).appearance).toBe("system");
  });

  it("survives malformed JSON", async () => {
    localStorage.setItem(KEY, "{broken");
    const store = new PrefStore();
    await store.load();
    expect(store.value.family).toBe("catppuccin");
  });
});
