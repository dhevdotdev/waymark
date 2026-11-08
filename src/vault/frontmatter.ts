export interface Frontmatter {
  data: Record<string, string | string[]>;
  body: string;
  /** Lines consumed by the frontmatter block, so source positions stay meaningful. */
  offset: number;
}

/**
 * Minimal YAML subset used by the vault: scalar `key: value` pairs and
 * string lists (`key: [a, b]` or indented `- item`). Other lines are ignored.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/.exec(source);
  if (!match) return { data: {}, body: source, offset: 0 };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value)) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: source.slice(match[0].length), offset: match[0].split("\n").length - 1 };
}

function unquote(v: string): string {
  return v.replace(/^(['"])(.*)\1$/, "$2");
}
