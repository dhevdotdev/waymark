import type { WriteOutcome } from "./source";

export type DraftState =
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "conflict"; disk: string }
  | { kind: "missing" }
  | { kind: "failed"; message: string };

type Write = (text: string, expected: string | null) => Promise<WriteOutcome>;

const SAVE_DELAY_MS = 400;

/**
 * The note being edited and what is known to be on disk. Saves run one at a
 * time and always state the text they expect to replace, so a change made
 * anywhere else stops autosaving until the user chooses what to keep.
 */
export class Draft {
  state: DraftState = { kind: "saved" };
  private base: string | null;
  private latest: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;

  constructor(
    text: string,
    private readonly write: Write,
    private readonly onState: (state: DraftState) => void,
    private readonly delayMs = SAVE_DELAY_MS,
  ) {
    this.base = text;
    this.latest = text;
  }

  get text(): string {
    return this.latest;
  }

  get hasUnsaved(): boolean {
    return this.latest !== this.base;
  }

  /** Resolves once no write is in flight. */
  async settled(): Promise<void> {
    await this.running;
  }

  /** Autosaving has stopped because a choice is needed. */
  get isBlocked(): boolean {
    return this.state.kind === "conflict" || this.state.kind === "missing";
  }

  update(text: string): void {
    this.latest = text;
    if (this.isBlocked) return;
    this.setState({ kind: "unsaved" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Saves anything pending. Resolves true when the disk holds the latest text. */
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    this.running ??= this.pump().finally(() => {
      this.running = null;
    });
    await this.running;
    if (this.hasUnsaved && !this.isBlocked && this.state.kind !== "failed") return this.flush();
    return !this.hasUnsaved;
  }

  /**
   * The file on disk now holds `disk`. Returns the text the editor should
   * show when it can follow along, which it can only do with nothing unsaved.
   */
  diskChanged(disk: string): string | null {
    if (disk === this.base || disk === this.latest || this.running) return null;
    if (this.hasUnsaved) {
      void this.flush();
      return null;
    }
    this.base = disk;
    this.latest = disk;
    this.setState({ kind: "saved" });
    return disk;
  }

  diskMissing(): void {
    if (this.base !== null && !this.running) this.setState({ kind: "missing" });
  }

  /** The user chose their text over the version on disk. */
  keepMine(): Promise<boolean> {
    if (this.state.kind === "conflict") this.base = this.state.disk;
    else if (this.state.kind === "missing") this.base = null;
    this.setState({ kind: "unsaved" });
    return this.flush();
  }

  /** The editor now shows `disk` and the user's text has been kept somewhere else. */
  adopt(disk: string): void {
    this.base = disk;
    this.latest = disk;
    this.setState({ kind: "saved" });
  }

  private async pump(): Promise<void> {
    while (this.latest !== this.base && !this.isBlocked) {
      const sending = this.latest;
      this.setState({ kind: "saving" });
      let outcome: WriteOutcome;
      try {
        outcome = await this.write(sending, this.base);
      } catch (error) {
        this.setState({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (outcome.kind === "changed") {
        if (outcome.current === sending) this.base = sending;
        else this.setState({ kind: "conflict", disk: outcome.current });
      } else if (outcome.kind === "missing") {
        this.setState({ kind: "missing" });
      } else {
        this.base = sending;
      }
    }
    if (!this.isBlocked) this.setState(this.hasUnsaved ? { kind: "unsaved" } : { kind: "saved" });
  }

  private setState(state: DraftState): void {
    this.state = state;
    this.onState(state);
  }
}
