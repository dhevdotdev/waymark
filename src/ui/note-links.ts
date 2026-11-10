import { native } from "../platform";
import type { VaultIndex } from "../vault/index";
import { type MenuItem, showContextMenu } from "./context-menu";

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** The vault's own link form: the note's name, or its path when another note shares the name. */
function wikilinkTo(index: VaultIndex, path: string, heading: string | null): string {
  const name = nameOf(path);
  const shared = index.notes.filter((note) => nameOf(note).toLowerCase() === name.toLowerCase()).length > 1;
  const target = shared ? path.replace(/\.md$/i, "") : name;
  /* These characters would end or split a link, so Obsidian replaces them with spaces too. */
  const section = heading
    ?.replace(/[#|^:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return section ? `[[${target}#${section}]]` : `[[${target}]]`;
}

export async function copyLink(
  index: VaultIndex,
  path: string,
  heading: string | null,
  toast: (message: string) => void,
): Promise<void> {
  const link = wikilinkTo(index, path, heading);
  try {
    await native.copyText(link);
    toast(`Copied ${link}`);
  } catch {
    toast("The link could not be copied.");
  }
}

interface LinkMenuHost {
  shell: HTMLElement;
  index: () => VaultIndex;
  path: () => string;
  toast: (message: string) => void;
}

const HEADINGS = ".doc :is(h1, h2, h3, h4, h5, h6), .doc-title, .fo-item, :is(.cm-h1, .cm-h2, .cm-h3, .cm-h4, .cm-h5, .cm-h6)";

/** What a heading says, without the Markdown markers shown on an edited line. */
function headingText(el: HTMLElement): string | null {
  if (el.matches(".doc-title")) return null;
  const label = el.querySelector(".fo-label")?.textContent ?? el.textContent ?? "";
  return label.replace(/^#{1,6}\s+/, "").trim() || null;
}

/** Right-clicking a heading, in Read, Edit or the outline, offers a link to that place. */
export function bindHeadingLinks(host: LinkMenuHost): void {
  host.shell.addEventListener("contextmenu", (e) => {
    const heading = (e.target as HTMLElement).closest<HTMLElement>(HEADINGS);
    const path = host.path();
    if (!heading || !path) return;
    e.preventDefault();
    const text = headingText(heading);
    const copy = (section: string | null) => void copyLink(host.index(), path, section, host.toast);
    const items: MenuItem[] = [
      ...(text ? [{ label: "Copy link to this heading", run: () => copy(text) }] : []),
      { label: "Copy link to this note", run: () => copy(null) },
    ];
    showContextMenu(e.clientX, e.clientY, items);
  });
}
