// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GitError, type GitStatus } from "../../src/platform";
import { describeSync } from "../../src/ui/sync-status";

const clean: GitStatus = {
  isRepo: true,
  branch: "main",
  head: "abc",
  upstream: "origin/main",
  remoteUrl: null,
  ahead: 0,
  behind: 0,
  files: [],
  operation: null,
};
const desktop = { desktop: true, everSynced: true };
const idle = { kind: "idle" } as const;
const change = { path: "a.md", origPath: null, staged: ".", unstaged: "M", conflicted: false };

describe("describeSync", () => {
  it.each([
    ["clean and checked", clean, "Synced", "ok"],
    ["ahead", { ...clean, ahead: 2 }, "2 to push", "outgoing"],
    ["behind", { ...clean, behind: 3 }, "3 incoming", "incoming"],
    ["both ways", { ...clean, ahead: 1, behind: 1 }, "Diverged", "warn"],
    ["edited", { ...clean, files: [change] }, "1 changed", "changed"],
    ["mid-merge", { ...clean, operation: "merge" }, "merge in progress", "warn"],
    ["no upstream", { ...clean, upstream: null }, "No remote", "off"],
    ["not a repository", { ...clean, isRepo: false }, "Local", "off"],
  ])("%s", (_name, status, text, tone) => {
    expect(describeSync(status, idle, desktop)).toMatchObject({ text, tone });
  });

  it("says when the remote has never been compared", () => {
    expect(describeSync(clean, idle, { desktop: true, everSynced: false }).text).toBe("Not checked");
  });

  it("names the failure and shows only its first line", () => {
    const state = { kind: "error", error: new GitError("auth", "denied\nmore detail") } as const;
    expect(describeSync(clean, state, desktop)).toEqual({ tone: "warn", text: "Sign-in needed", tip: "denied" });
  });

  it("treats being offline as quiet rather than a warning", () => {
    const state = { kind: "error", error: new GitError("offline", "no network") } as const;
    expect(describeSync(clean, state, desktop).tone).toBe("off");
  });

  it("does not claim a sync state in the browser preview", () => {
    expect(describeSync(clean, idle, { desktop: false, everSynced: true }).text).toBe("Preview");
  });
});
