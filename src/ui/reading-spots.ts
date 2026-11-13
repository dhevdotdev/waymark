import type { PrefStore } from "../prefs";
import { revealFolded } from "./reading-folds";

export interface ScrollAnchor {
  line: number;
  offset: number;
}

interface Spot extends ScrollAnchor {
  at: number;
}

const SPOTS_KEPT = 500;
const SETTLE_MS = 300;

const readingBlocks = (scroller: HTMLElement) => [...scroller.querySelectorAll<HTMLElement>(".doc [data-line]")];

/** The block at the top of the reading view, and how far it sits from that edge. */
export function readingAnchor(scroller: HTMLElement): ScrollAnchor | null {
  if (scroller.scrollTop <= 0) return null;
  const top = scroller.getBoundingClientRect().top;
  const block = readingBlocks(scroller).find((candidate) => candidate.getBoundingClientRect().bottom > top);
  return block ? { line: Number(block.dataset.line), offset: block.getBoundingClientRect().top - top } : null;
}

/** Puts a line back at the same height. A note that got shorter ends up at its last block. */
export function showReadingLine(scroller: HTMLElement, { line, offset }: ScrollAnchor): void {
  const block = readingBlocks(scroller).findLast((candidate) => Number(candidate.dataset.line) <= line);
  if (!block) return;
  revealFolded(block);
  const box = block.getBoundingClientRect();
  scroller.scrollTop += box.top - scroller.getBoundingClientRect().top - Math.max(offset, -box.height);
}

const isSpot = (value: unknown): value is Spot => {
  const spot = value as Spot | null;
  return Number.isFinite(spot?.line) && Number.isFinite(spot?.offset) && Number.isFinite(spot?.at);
};

/** Keeps the place in a note that was renamed or moved. */
export function moveSpot(prefs: PrefStore, root: string, from: string, to: string): void {
  prefs.update((p) => {
    const spots = p.vaults[root]?.spots;
    if (!spots?.[from]) return;
    spots[to] = spots[from];
    delete spots[from];
  });
}

export interface ReadingSpotsHost {
  prefs: PrefStore;
  root: string;
  scroller: HTMLElement;
  /** The note on screen, or null when it is not a note. */
  note: () => string | null;
  /** The editor's top line, or null when nothing is being edited. */
  editingAnchor: () => ScrollAnchor | null;
  isEditing: () => boolean;
}

/** Where reading stopped in each note. Kept in the app's preferences, never in the note. */
export class ReadingSpots {
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private restored: { spot: ScrollAnchor; top: number } | null = null;

  constructor(private readonly host: ReadingSpotsHost) {}

  scrolled(): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.record(), SETTLE_MS);
  }

  /** Notes the position of the note on screen, forgetting it at the top because that is where a note opens anyway. */
  record(): void {
    clearTimeout(this.settleTimer);
    const { note, isEditing, editingAnchor, scroller, prefs, root } = this.host;
    const path = note();
    if (!path || !scroller.querySelector(".doc, .doc-editing")) return;
    const anchor = isEditing() ? editingAnchor() : readingAnchor(scroller);
    prefs.update((p) => {
      p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
      p.vaults[root].spots ??= {};
      const spots = p.vaults[root].spots;
      if (anchor) spots[path] = { ...anchor, at: Date.now() };
      else delete spots[path];
      const paths = Object.keys(spots);
      if (paths.length <= SPOTS_KEPT) return;
      const oldest = paths.sort((a, b) => (spots[a]?.at ?? 0) - (spots[b]?.at ?? 0));
      for (const old of oldest.slice(0, paths.length - SPOTS_KEPT)) delete spots[old];
    });
  }

  /** Scrolls a freshly mounted note to where reading stopped, before it is painted. */
  restore(path: string): void {
    this.restored = null;
    const { prefs, root, scroller } = this.host;
    const spot = prefs.value.vaults[root]?.spots?.[path];
    if (!isSpot(spot)) return;
    showReadingLine(scroller, spot);
    this.restored = { spot, top: scroller.scrollTop };
  }

  /** Blocks above the spot may have changed height while drawing. Holds the place unless the reader has moved on. */
  settle(): void {
    if (!this.restored || this.host.scroller.scrollTop !== this.restored.top) {
      this.restored = null;
      return;
    }
    showReadingLine(this.host.scroller, this.restored.spot);
    this.restored = null;
  }
}
