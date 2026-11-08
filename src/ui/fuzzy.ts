import { escapeRegExp } from "../vault/search";

const BOUNDARY = /[\s\-_/(.,:]/;

/**
 * Title matching for the palette. Every query word must appear in the title,
 * preferably at the start of a word; a single word may also match as an
 * acronym of word starts ("tc" → "TLS certificates"). Scattered letters never
 * match, so highlights are always whole runs or word initials.
 */
export function fuzzy(query: string, text: string): { score: number; marks: number[] } | null {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return { score: 0, marks: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const atWord = direct === 0 || BOUNDARY.test(t[direct - 1]);
    return {
      score: 1000 - direct * 2 + (atWord ? 300 : 0) - t.length * 0.5,
      marks: [...Array(q.length).keys()].map((i) => i + direct),
    };
  }
  const words = q.split(/\s+/);
  const marks: number[] = [];
  let score = 0;
  let allFound = true;
  for (const w of words) {
    const m = new RegExp(`(^|${BOUNDARY.source})${escapeRegExp(w)}`).exec(t);
    const at = m ? m.index + m[1].length : w.length >= 3 ? t.indexOf(w) : -1;
    if (at >= 0) {
      score += m ? 120 : 40;
      for (let i = 0; i < w.length; i++) marks.push(at + i);
      continue;
    }
    const within = abbreviation(w, t);
    if (!within) {
      allFound = false;
      break;
    }
    score += 25;
    marks.push(...within);
  }
  if (allFound) return { score: score - t.length * 0.5, marks };
  if (words.length > 1) return null;
  const starts = [...t.matchAll(new RegExp(`(^|${BOUNDARY.source})([^\\s])`, "g"))].map((m) => m.index! + m[1].length);
  const acronym: number[] = [];
  let si = 0;
  for (const ch of q) {
    while (si < starts.length && t[starts[si]] !== ch) si++;
    if (si >= starts.length) return null;
    acronym.push(starts[si++]);
  }
  return { score: 300 - t.length * 0.5, marks: acronym };
}

/** `w` as an abbreviation of one title word that starts with the same letter ("certs" → "certificates"). */
function abbreviation(w: string, t: string): number[] | null {
  for (const m of t.matchAll(new RegExp(`(^|${BOUNDARY.source})(${escapeRegExp(w[0])}[^\\s,:;]*)`, "g"))) {
    const start = m.index! + m[1].length;
    const word = m[2];
    const marks = [start];
    let wi = 1;
    for (let qi = 1; qi < w.length; qi++) {
      const found = word.indexOf(w[qi], wi);
      if (found < 0) {
        marks.length = 0;
        break;
      }
      marks.push(start + found);
      wi = found + 1;
    }
    if (marks.length === w.length) return marks;
  }
  return null;
}

export function highlightMarks(text: string, marks: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(marks);
  let buf = "";
  let inMark = false;
  const flush = () => {
    if (!buf) return;
    if (inMark) {
      const m = document.createElement("mark");
      m.textContent = buf;
      frag.append(m);
    } else frag.append(buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const isMark = set.has(i);
    if (isMark !== inMark) {
      flush();
      inMark = isMark;
    }
    buf += text[i];
  }
  flush();
  return frag;
}
