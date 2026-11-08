export interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  notes: string[];
  /** Notes in this folder and everything below it. */
  count: number;
}

const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The vault's folders exactly as they are on disk: folders first, then notes, in natural name order. */
export function buildTree(notes: string[]): TreeFolder {
  const root: TreeFolder = { name: "", path: "", folders: [], notes: [], count: 0 };
  const byPath = new Map<string, TreeFolder>([["", root]]);
  for (const note of notes) {
    const parts = note.split("/").slice(0, -1);
    let here = root;
    here.count++;
    let path = "";
    for (const name of parts) {
      path = path ? `${path}/${name}` : name;
      let next = byPath.get(path);
      if (!next) {
        next = { name, path, folders: [], notes: [], count: 0 };
        byPath.set(path, next);
        here.folders.push(next);
      }
      next.count++;
      here = next;
    }
    here.notes.push(note);
  }
  for (const folder of byPath.values()) {
    folder.folders.sort((a, b) => order.compare(a.name, b.name));
    folder.notes.sort((a, b) => order.compare(fileName(a), fileName(b)));
  }
  return root;
}

/** Every folder containing `path`, outermost first. */
export function ancestors(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}
