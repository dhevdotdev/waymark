import { describe, expect, it } from "vitest";
import { parseSearchQuery, passesFilters, usesFilters } from "../../src/vault/search-query";

describe("parseSearchQuery", () => {
  it("separates words, phrases, exclusions and paths", () => {
    expect(parseSearchQuery('rye "cold retard" -wheat path:Baking -path:Old -"sour dough"')).toEqual({
      words: ["rye"],
      phrases: ["cold retard"],
      notWords: ["wheat"],
      notPhrases: ["sour dough"],
      paths: ["Baking"],
      notPaths: ["Old"],
    });
  });

  it("reads a quoted path with spaces", () => {
    expect(parseSearchQuery('path:"Night sky"').paths).toEqual(["Night sky"]);
  });

  it("keeps hyphens inside a word", () => {
    expect(parseSearchQuery("well-known").words).toEqual(["well-known"]);
  });

  it("ignores a filter still being typed", () => {
    expect(usesFilters(parseSearchQuery("rye -"))).toBe(false);
    expect(usesFilters(parseSearchQuery("rye path:"))).toBe(false);
  });

  it("leaves a plain query or one whole phrase to ordinary search", () => {
    expect(usesFilters(parseSearchQuery("two words"))).toBe(false);
    expect(usesFilters(parseSearchQuery('"one phrase"'))).toBe(false);
    expect(usesFilters(parseSearchQuery('"one phrase" more'))).toBe(true);
  });
});

describe("passesFilters", () => {
  const path = "Baking/Sourdough/Crumb.md";
  it("matches a path anywhere, ignoring case", () => {
    expect(passesFilters(parseSearchQuery("path:sourdough"), path, "x")).toBe(true);
    expect(passesFilters(parseSearchQuery("-path:baking"), path, "x")).toBe(false);
  });
  it("excludes whole words only", () => {
    expect(passesFilters(parseSearchQuery("-rye"), path, "A rye loaf")).toBe(false);
    expect(passesFilters(parseSearchQuery("-rye"), path, "Dryer air")).toBe(true);
  });
  it("needs every phrase", () => {
    expect(passesFilters(parseSearchQuery('"a b" "c d"'), path, "a b then c d")).toBe(true);
    expect(passesFilters(parseSearchQuery('"a b" "c d"'), path, "a b only")).toBe(false);
  });
});
