export interface Destination {
  /** The part that decides who you reach. Always shown whole. */
  site: string;
  rest: string;
}

const READABLE = /^[\p{L}\p{M}\p{N} ]+$/u;
const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

/** Decodes only what reads as plain words. A decoded slash, dot or direction mark could pose as part of the address. */
function decodeWords(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      const decoded = decodeURIComponent(run);
      return READABLE.test(decoded) && !RIGHT_TO_LEFT.test(decoded) ? decoded : run;
    } catch {
      return run;
    }
  });
}

/**
 * Where a web or mail link really goes, or null for anything else. The host
 * stays as the URL parser wrote it: international names remain in their
 * `xn--` form, because a decoded name can imitate another site's letters.
 */
export function destinationOf(href: string): Destination | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.pathname ? { site: url.pathname, rest: "" } : null;
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host) return null;
  const path = url.pathname === "/" && !url.search && !url.hash ? "" : url.pathname;
  return {
    site: url.protocol === "http:" ? `http://${url.host}` : url.host,
    rest: decodeWords(`${path}${url.search}${url.hash}`),
  };
}

/** Keeps `keep` characters of `chars`, more from the start than the end, with an ellipsis between. */
export function cutMiddle(chars: readonly string[], keep: number): string {
  const head = Math.ceil(keep * 0.6);
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - (keep - head)).join("")}`;
}
