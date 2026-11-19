import { Palette, type PaletteItem } from "./palette";

export interface VaultChoice {
  path: string;
  name: string;
  /** The folder it sits in, with the home folder written as ~. */
  place: string;
  state: "current" | "available" | "missing";
}

export interface SwitcherHost {
  recent: () => string[];
  current: string;
  /** Whether each folder is still there. */
  exists: (paths: string[]) => Promise<boolean[]>;
  switchTo: (path: string) => void;
  openAnother: () => void;
  forget: (path: string) => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
}

const home = (path: string) => path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");

/** Recent vaults, the open one first, each saying whether it can be opened. */
export function vaultChoices(recent: string[], current: string, exists: boolean[]): VaultChoice[] {
  const choices = recent.map((path, i): VaultChoice => {
    const cut = path.replace(/\/+$/, "");
    const at = cut.lastIndexOf("/");
    return {
      path,
      name: cut.slice(at + 1) || cut,
      place: home(at > 0 ? cut.slice(0, at) : "/"),
      state: path === current ? "current" : exists[i] === false ? "missing" : "available",
    };
  });
  return [...choices.filter((c) => c.state === "current"), ...choices.filter((c) => c.state !== "current")];
}

const DETAIL: Record<VaultChoice["state"], (choice: VaultChoice) => string> = {
  current: () => "Open now",
  available: (choice) => choice.place,
  missing: () => "Folder not found",
};

/** The palette's list of recent vaults. Unsaved text is the host's to save before it switches. */
export class VaultSwitcher {
  private items: PaletteItem[] = [];
  private readonly palette = new Palette(
    () => this.items,
    () => this.items,
    { placeholder: "Switch to a recent vault", compact: true },
  );

  constructor(private readonly host: SwitcherHost) {}

  async open(): Promise<void> {
    const recent = this.host.recent();
    const exists = await this.host.exists(recent).catch(() => recent.map(() => true));
    this.items = [
      ...vaultChoices(recent, this.host.current, exists).map((choice) => this.item(choice)),
      { id: "open-another", label: "Open another vault…", group: "Elsewhere", run: () => this.host.openAnother() },
    ];
    this.palette.open();
  }

  private item(choice: VaultChoice): PaletteItem {
    return {
      id: choice.path,
      label: choice.name,
      detail: DETAIL[choice.state](choice),
      keywords: choice.path,
      group: "Recent vaults",
      run: () => this.choose(choice),
    };
  }

  private choose(choice: VaultChoice): void {
    if (choice.state === "current") return;
    if (choice.state === "available") {
      this.host.switchTo(choice.path);
      return;
    }
    this.host.toast(`“${choice.name}” is no longer in ${choice.place}.`, {
      label: "Remove from list",
      run: () => this.host.forget(choice.path),
    });
  }
}
