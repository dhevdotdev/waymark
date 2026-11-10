import { beforeAll, describe, expect, it } from "vitest";
import { loadYaml, noteBody, parseFrontmatter } from "../../src/vault/frontmatter";
import { addProperty, readSheet, removeProperty, setList, setText } from "../../src/vault/properties";

beforeAll(loadYaml);

const note = (...lines: string[]) => `---\n${lines.join("\n")}\n---\n# Title\n\nBody text.\n`;
const form = (source: string, key: string) => readSheet(source).properties.find((p) => p.key === key)?.form;

describe("reading properties", () => {
  it("reads names with spaces and dots", () => {
    const { data } = parseFrontmatter(note("Due date: 2024-05-01", "a.b: 1"));
    expect(data["Due date"]).toBe("2024-05-01");
    expect(data["a.b"]).toBe("1");
  });

  it("shows a nested value as written", () => {
    const { data } = parseFrontmatter(note("place:", "  city: Paris", "  zip: 75001", "next: x"));
    expect(data.place).toBe("city: Paris\nzip: 75001");
    expect(data.next).toBe("x");
  });

  it("keeps numbers as typed", () => {
    expect(parseFrontmatter(note("v: 1.0", "b: true")).data).toEqual({ v: "1.0", b: "true" });
  });

  it("reads lists either way and quoted items", () => {
    const { data } = parseFrontmatter(note("a: [x, 'y z']", "b:", "  - one", '  - "two"', "c:", "- three"));
    expect(data).toEqual({ a: ["x", "y z"], b: ["one", "two"], c: ["three"] });
  });

  it("keeps offset and body exact, with either line ending", () => {
    const text = "---\na: 1\nb: 2\n---\nbody";
    expect(parseFrontmatter(text).offset).toBe(4);
    expect(parseFrontmatter(text).body).toBe("body");
    expect(noteBody(text)).toBe("body");
    expect(parseFrontmatter("---\r\na: 1\r\n---\r\nbody").body).toBe("body");
    expect(parseFrontmatter("---\n---\nbody").offset).toBe(2);
  });

  it("still reads what it can from YAML that does not parse", () => {
    const { data, body } = parseFrontmatter(note("title: Foo: bar", "status: unread", "tags: [a"));
    expect(data.status).toBe("unread");
    expect(data.title).toBe("Foo: bar");
    expect(body).toBe("# Title\n\nBody text.\n");
  });

  it("survives hostile input", () => {
    const deep = `---\na: ${"[".repeat(60000)}\n---\nbody`;
    expect(parseFrontmatter(deep).body).toBe("body");
    const huge = `---\na: ${"x".repeat(200000)}\n---\nbody`;
    expect(parseFrontmatter(huge).body).toBe("body");
    const aliases = ["a: &a [x, x]", "b: &b [*a, *a]", "c: &c [*b, *b]", "d: [*c, *c, *c]"];
    expect(parseFrontmatter(note(...aliases)).body).toContain("Body text");
    const proto = parseFrontmatter(note("__proto__: [x]", "constructor: y")).data;
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(proto.constructor).toBe("y");
  });
});

describe("changing a value rewrites only that value", () => {
  const messy = [
    "# a comment at the top",
    "status:   unread   # keep this",
    "",
    "'quoted key': 'single'",
    'double: "dq"',
    "tags: [a, 'b c' , d]",
    "aliases:",
    "  - One",
    '  - "Two"',
    "zeta: last",
  ];
  const source = note(...messy);

  it("leaves every other byte alone", () => {
    expect(setText(source, "status", "read")).toBe(source.replace("unread", "read"));
    expect(setText(source, "quoted key", "it's")).toBe(source.replace("'single'", "'it''s'"));
    expect(setText(source, "double", 'say "hi"')).toBe(source.replace('"dq"', '"say \\"hi\\""'));
    expect(setText(source, "zeta", "end")).toBe(source.replace("zeta: last", "zeta: end"));
  });

  it("works the same with Windows line endings", () => {
    const crlf = source.replace(/\n/g, "\r\n");
    expect(setText(crlf, "status", "read")).toBe(crlf.replace("unread", "read"));
    expect(addProperty(crlf, "new", "v")).toBe(crlf.replace("zeta: last\r\n", "zeta: last\r\nnew: v\r\n"));
    expect(removeProperty(crlf, "double")).toBe(crlf.replace('double: "dq"\r\n', ""));
    expect(setList(crlf, "aliases", ["One", "Three"])).toBe(crlf.replace('  - "Two"', "  - Three"));
  });

  it.each([
    ["a: b", '"a: b"'],
    ["x #y", '"x #y"'],
    ["'q", `"'q"`],
    ["[br", '"[br"'],
    ["{br", '"{br"'],
    ["yes", '"yes"'],
    ["No", '"No"'],
    ["12", '"12"'],
    ["1.5", '"1.5"'],
    ["null", '"null"'],
    ["~", '"~"'],
    ["- x", '"- x"'],
    ["*star", '"*star"'],
    ["&amp", '"&amp"'],
    ["!tag", '"!tag"'],
    ["%d", '"%d"'],
    ["@at", '"@at"'],
    ["plain words", "plain words"],
    ["2024-05-01", "2024-05-01"],
    ["ünï çødé", "ünï çødé"],
  ])("writes %s so it reads back exactly", (typed, written) => {
    const start = note("k: old", "other: x");
    const after = setText(start, "k", typed)!;
    expect(after).toBe(start.replace("k: old", `k: ${written}`));
    expect(parseFrontmatter(after).data.k).toBe(typed);
    expect(parseFrontmatter(after).data.other).toBe("x");
  });

  it("keeps a number a number and a boolean a boolean", () => {
    expect(setText(note("n: 1"), "n", "2")).toBe(note("n: 2"));
    expect(setText(note("b: true"), "b", "false")).toBe(note("b: false"));
    expect(setText(note("n: 1"), "n", "many")).toBe(note("n: many"));
  });

  it("fills and clears an empty value", () => {
    expect(setText(note("k:", "z: 1"), "k", "v")).toBe(note("k: v", "z: 1"));
    expect(setText(note("k: v", "z: 1"), "k", "")).toBe(note("k:", "z: 1"));
    expect(setText(note("k:   # c", "z: 1"), "k", "v")).toBe(note("k: v   # c", "z: 1"));
  });

  it("returns the same text when nothing changed", () => {
    expect(setText(source, "status", "unread")).toBe(source);
    expect(setList(source, "aliases", ["One", "Two"])).toBe(source);
    expect(setList(source, "tags", ["a", "b c", "d"])).toBe(source.replace("[a, 'b c' , d]", "[a, 'b c', d]"));
  });
});

describe("lists", () => {
  it("edits block lists and keeps untouched items exactly", () => {
    const start = note("aliases:", "  - One", '  - "Two"', "z: 1");
    expect(setList(start, "aliases", ["One", "Two", "a: b"])).toBe(
      note("aliases:", "  - One", '  - "Two"', '  - "a: b"', "z: 1"),
    );
    expect(setList(start, "aliases", ["Two"])).toBe(note("aliases:", '  - "Two"', "z: 1"));
    expect(setList(start, "aliases", [])).toBe(note("aliases: []", "z: 1"));
  });

  it("keeps the indent the list uses", () => {
    expect(setList(note("a:", "- x"), "a", ["x", "y"])).toBe(note("a:", "- x", "- y"));
    expect(setList(note("a:", "    - x"), "a", ["y"])).toBe(note("a:", "    - y"));
  });

  it("edits inline lists, quoting what would break them", () => {
    expect(setList(note("a: [x]"), "a", ["x", "b, c", "d]"])).toBe(note('a: [x, "b, c", "d]"]'));
    expect(setList(note("a: []"), "a", ["x"])).toBe(note("a: [x]"));
    expect(setList(note("a: [x]"), "a", [])).toBe(note("a: []"));
  });
});

describe("adding and removing", () => {
  it("adds at the end of the block", () => {
    expect(addProperty(note("a: 1"), "Due date", "soon")).toBe(note("a: 1", "Due date: soon"));
    expect(addProperty(note("a: 1"), "k", "")).toBe(note("a: 1", "k:"));
    expect(addProperty(note("a: 1"), "a: b", "v")).toBe(note("a: 1", '"a: b": v'));
  });

  it("creates the block at the very top, leaving the body exact", () => {
    expect(addProperty("# T\n\nbody", "k", "v")).toBe("---\nk: v\n---\n# T\n\nbody");
    expect(addProperty("\n\nbody\r\n", "k", "v")).toBeNull();
    expect(addProperty("", "k", "v")).toBe("---\nk: v\n---\n");
    expect(addProperty("---\n---\nbody", "k", "v")).toBe("---\nk: v\n---\nbody");
    expect(addProperty("a\r\nb\r\n", "k", "v")).toBe("---\r\nk: v\r\n---\r\na\r\nb\r\n");
  });

  it("refuses a name that is already there", () => {
    expect(addProperty(note("a: 1"), "a", "2")).toBeNull();
  });

  it("removes only that property's lines", () => {
    const start = note("# c", "a: 1 # note", "b:", "  - x", "  - y", "", "c: 3");
    expect(removeProperty(start, "a")).toBe(note("# c", "b:", "  - x", "  - y", "", "c: 3"));
    expect(removeProperty(start, "b")).toBe(note("# c", "a: 1 # note", "", "c: 3"));
    expect(removeProperty(start, "c")).toBe(note("# c", "a: 1 # note", "b:", "  - x", "  - y", ""));
  });

  it("removes the block with the last property", () => {
    expect(removeProperty(note("a: 1"), "a")).toBe("# Title\n\nBody text.\n");
    expect(removeProperty("---\na: 1\n---\n---\nb: 2\n---\nbody", "a")).toBeNull();
    expect(removeProperty(note("# keep", "a: 1"), "a")).toBe(note("# keep"));
  });
});

describe("what is shown but never rewritten", () => {
  it.each([
    ["nested maps", ["a:", "  b: 1"]],
    ["lists of maps", ["a:", "  - b: 1"]],
    ["block text", ["a: |", "  line one", "  line two"]],
    ["folded text", ["a: >", "  folded"]],
    ["a value over two lines", ["a: one", "  two"]],
    ["anchors", ["a: &x 1"]],
    ["aliases", ["b: &x 1", "a: *x"]],
    ["tags", ["a: !!str 1"]],
    ["commented lists", ["a:", "  - x # c", "  - y"]],
    ["lists with gaps", ["a:", "  - x", "", "  - y"]],
    ["nested lists", ["a: [[x]]"]],
  ])("%s", (_, lines) => {
    const source = note(...lines);
    expect(form(source, "a")).toBe("fixed");
    expect(setText(source, "a", "z")).toBeNull();
    expect(setList(source, "a", ["z"])).toBeNull();
    expect(removeProperty(source, "a")).toBeNull();
  });

  it("duplicate names are both fixed", () => {
    const source = note("a: 1", "b: 2", "a: 3");
    expect(readSheet(source).properties.map((p) => p.form)).toEqual(["fixed", "text", "fixed"]);
    expect(setText(source, "a", "z")).toBeNull();
    expect(setText(source, "b", "z")).toBe(source.replace("b: 2", "b: z"));
  });

  it("offers nothing on YAML that does not parse, or on mixed line endings", () => {
    expect(readSheet(note("a: [x")).canAdd).toBe(false);
    expect(addProperty(note("a: [x"), "k", "v")).toBeNull();
    const mixed = "---\na: 1\r\n---\nbody\n";
    expect(readSheet(mixed).properties.every((p) => p.form === "fixed")).toBe(true);
    expect(setText(mixed, "a", "2")).toBeNull();
  });

  it("gives each property's file line", () => {
    expect(readSheet(note("# c", "a: 1", "", "b: 2")).properties.map((p) => p.line)).toEqual([2, 4]);
  });
});
