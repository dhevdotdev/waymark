import { describe, expect, it } from "vitest";
import { linkedNotePath, type NewNotePlace } from "../../src/vault/new-note-path";

const ROOT: NewNotePlace = { location: "root", folder: "", here: "Trips" };
const INBOX: NewNotePlace = { location: "folder", folder: "Inbox", here: "Trips" };
const BESIDE: NewNotePlace = { location: "current", folder: "Inbox", here: "Trips/Later" };
const pathOf = (target: string, place = INBOX) => {
  const result = linkedNotePath(target, place);
  return result.kind === "path" ? result.path : null;
};
const reasonOf = (target: string) => {
  const result = linkedNotePath(target, INBOX);
  return result.kind === "refused" ? result.reason : null;
};

describe("linkedNotePath", () => {
  it("puts a bare name where Obsidian puts new notes", () => {
    expect(pathOf("Kafka", ROOT)).toBe("Kafka.md");
    expect(pathOf("Kafka", INBOX)).toBe("Inbox/Kafka.md");
    expect(pathOf("Kafka", BESIDE)).toBe("Trips/Later/Kafka.md");
  });

  it("treats an unknown location setting as the vault root", () => {
    expect(pathOf("Kafka", { location: "", folder: "Inbox", here: "Trips" })).toBe("Kafka.md");
  });

  it("falls back to the root when the folder setting is empty", () => {
    expect(pathOf("Kafka", { location: "folder", folder: "", here: "Trips" })).toBe("Kafka.md");
  });

  it("reads a target with a folder as a path from the vault root", () => {
    expect(pathOf("Areas/Reading/Kafka")).toBe("Areas/Reading/Kafka.md");
    expect(pathOf("Areas/Kafka", BESIDE)).toBe("Areas/Kafka.md");
  });

  it("reads a leading slash as the vault root, even for a bare name", () => {
    expect(pathOf("/Kafka")).toBe("Kafka.md");
    expect(pathOf("/Areas/Kafka")).toBe("Areas/Kafka.md");
  });

  it("does not double the extension", () => {
    expect(pathOf("Kafka.md")).toBe("Inbox/Kafka.md");
    expect(pathOf("Kafka.MD")).toBe("Inbox/Kafka.md");
  });

  it("keeps spaces, punctuation and other scripts that a file name can hold", () => {
    expect(pathOf("Notes on Kafka (2nd ed.)")).toBe("Inbox/Notes on Kafka (2nd ed.).md");
    expect(pathOf("東京 – 旅")).toBe("Inbox/東京 – 旅.md");
  });

  it("ignores spaces around the target and doubled slashes", () => {
    expect(pathOf("  Kafka  ")).toBe("Inbox/Kafka.md");
    expect(pathOf("Areas//Kafka/")).toBe("Areas/Kafka.md");
  });

  it("refuses names a file cannot have, and says why", () => {
    expect(reasonOf("Time: 10am")).toContain("cannot contain");
    expect(reasonOf("back\\slash")).toContain("cannot contain");
    expect(reasonOf(".hidden")).toContain("cannot start with a dot");
  });

  it("refuses a target that climbs between folders", () => {
    expect(reasonOf("../Kafka")).toContain("cannot start with a dot");
    expect(reasonOf("Areas/./Kafka")).toContain("cannot start with a dot");
  });

  it("refuses an empty target", () => {
    expect(reasonOf("")).toBe("This link has no name to give a note.");
    expect(reasonOf(" / ")).toBe("This link has no name to give a note.");
  });

  it("names the target it refused", () => {
    expect(reasonOf("a:b")).toContain("“a:b”");
  });
});
