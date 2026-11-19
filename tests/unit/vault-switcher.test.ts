// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SwitcherHost, VaultSwitcher, vaultChoices } from "../../src/ui/vault-switcher";

const NOTES = "/Users/sam/Documents/notes";
const WORK = "/Users/sam/work";
const GONE = "/Volumes/Stick/old";

describe("vaultChoices", () => {
  it("names each vault by its folder and says where it is", () => {
    const [choice] = vaultChoices([NOTES], "", [true]);
    expect(choice).toEqual({ path: NOTES, name: "notes", place: "~/Documents", state: "available" });
  });

  it("puts the open vault first and marks it", () => {
    const choices = vaultChoices([WORK, NOTES, GONE], NOTES, [true, true, true]);
    expect(choices.map((c) => [c.name, c.state])).toEqual([
      ["notes", "current"],
      ["work", "available"],
      ["old", "available"],
    ]);
  });

  it("marks a folder that has gone", () => {
    expect(vaultChoices([GONE], NOTES, [false])[0].state).toBe("missing");
  });

  it("keeps a vault available when its check gave no answer", () => {
    expect(vaultChoices([WORK, GONE], NOTES, [true])[1].state).toBe("available");
  });

  it("copes with a trailing slash, the home folder itself and the disk root", () => {
    expect(vaultChoices(["/Users/sam/notes/"], "", [true])[0]).toMatchObject({ name: "notes", place: "~" });
    expect(vaultChoices(["/notes"], "", [true])[0]).toMatchObject({ name: "notes", place: "/" });
  });
});

describe("VaultSwitcher", () => {
  beforeAll(() => {
    /* jsdom lays nothing out, so it has no scrolling to do. */
    Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  const setUp = (exists: (paths: string[]) => Promise<boolean[]> = async (paths) => paths.map((p) => p !== GONE)) => {
    const host: SwitcherHost = {
      recent: () => [NOTES, WORK, GONE],
      current: NOTES,
      exists,
      switchTo: vi.fn(),
      openAnother: vi.fn(),
      forget: vi.fn(),
      toast: vi.fn(),
    };
    return { host, switcher: new VaultSwitcher(host) };
  };
  const rows = () =>
    [...document.querySelectorAll(".palette-row")].map((row) => [
      row.querySelector(".palette-label")?.textContent,
      row.querySelector(".palette-detail")?.textContent ?? "",
    ]);
  const choose = (label: string) => {
    const row = [...document.querySelectorAll<HTMLElement>(".palette-row")].find(
      (r) => r.querySelector(".palette-label")?.textContent === label,
    );
    row?.click();
  };

  it("lists recent vaults with the open one marked, a gone one flagged, and a way to open another", async () => {
    const { switcher } = setUp();
    await switcher.open();
    expect(rows()).toEqual([
      ["notes", "Open now"],
      ["work", "~"],
      ["old", "Folder not found"],
      ["Open another vault…", ""],
    ]);
  });

  it("switches to an available vault", async () => {
    const { host, switcher } = setUp();
    await switcher.open();
    choose("work");
    expect(host.switchTo).toHaveBeenCalledWith(WORK);
  });

  it("does nothing for the vault already open", async () => {
    const { host, switcher } = setUp();
    await switcher.open();
    choose("notes");
    expect(host.switchTo).not.toHaveBeenCalled();
    expect(host.toast).not.toHaveBeenCalled();
  });

  it("never tries to open a gone folder, and offers to drop it from the list", async () => {
    const { host, switcher } = setUp();
    await switcher.open();
    choose("old");
    expect(host.switchTo).not.toHaveBeenCalled();
    const [message, action] = vi.mocked(host.toast).mock.calls[0];
    expect(message).toBe("“old” is no longer in /Volumes/Stick.");
    action?.run();
    expect(host.forget).toHaveBeenCalledWith(GONE);
  });

  it("offers the folder picker", async () => {
    const { host, switcher } = setUp();
    await switcher.open();
    choose("Open another vault…");
    expect(host.openAnother).toHaveBeenCalled();
  });

  it("still lists every vault when the folders cannot be checked", async () => {
    const { switcher } = setUp(() => Promise.reject(new Error("no IPC")));
    await switcher.open();
    expect(rows()[2]).toEqual(["old", "/Volumes/Stick"]);
  });
});
