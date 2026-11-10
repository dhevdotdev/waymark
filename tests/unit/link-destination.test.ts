import { describe, expect, it } from "vitest";
import { cutMiddle, destinationOf } from "../../src/render/link-destination";

const shown = (href: string) => {
  const d = destinationOf(href);
  return d ? `${d.site}|${d.rest}` : null;
};

describe("destinationOf", () => {
  it("drops https and keeps the path, query and fragment", () => {
    expect(shown("https://example.com/a/b?c=1#d")).toBe("example.com|/a/b?c=1#d");
    expect(shown("https://example.com/")).toBe("example.com|");
  });

  it("keeps http visible and a port with the site", () => {
    expect(shown("http://example.com/x")).toBe("http://example.com|/x");
    expect(shown("https://example.com:8443/x")).toBe("example.com:8443|/x");
  });

  it("shows only the address for mail", () => {
    expect(shown("mailto:someone@example.com?subject=Hi")).toBe("someone@example.com|");
    expect(shown("mailto:")).toBeNull();
  });

  it("names the real host when the address tries to hide it", () => {
    expect(shown("https://github.com.login-check.net/session")).toBe("github.com.login-check.net|/session");
    expect(shown("https://github.com@evil.test/")).toBe("evil.test|");
    expect(shown("https://github.com:secret@evil.test/x")).toBe("evil.test|/x");
    expect(shown("https://evil.test/https://github.com/")).toBe("evil.test|/https://github.com/");
    expect(shown("https:\\\\evil.test\\x")).toBe("evil.test|/x");
  });

  it("leaves international hosts undecoded", () => {
    expect(shown("https://xn--pple-43d.com/")).toBe("xn--pple-43d.com|");
    expect(shown("https://аррӏе.com/")?.startsWith("xn--")).toBe(true);
  });

  it("decodes plain words in the path only", () => {
    expect(shown("https://example.com/caf%C3%A9%20menu")).toBe("example.com|/café menu");
  });

  it("does not decode anything that could pose as part of the address", () => {
    for (const piece of ["%2F", "%2E", "%3F", "%40", "%E2%81%84", "%EF%BC%8F", "%E2%80%AE", "%D7%90", "%00", "%0A", "%FF"]) {
      expect(shown(`https://evil.test/a${piece}b`)).toBe(`evil.test|/a${piece}b`);
    }
  });

  it("ignores anything that is not a web or mail link", () => {
    for (const href of [
      "Notes/A.md",
      "#part",
      "vault://localhost/x",
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x.test",
      "https://",
    ]) {
      expect(shown(href)).toBeNull();
    }
  });
});

describe("cutMiddle", () => {
  it("keeps more of the start and marks the gap", () => {
    expect(cutMiddle([..."abcdefghij"], 5)).toBe("abc…ij");
    expect(cutMiddle([..."abcdefghij"], 0)).toBe("…");
  });

  it("never splits a character", () => {
    expect(cutMiddle(Array.from("😀😀😀😀😀"), 3)).toBe("😀😀…😀");
  });
});
