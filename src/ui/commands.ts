import { markKeyboardOrigin } from "./input-origin";

/** How a command was started, for the few commands that behave differently per surface. */
export type Origin = "key" | "click" | "palette";

export interface Command {
  id: string;
  run: (origin: Origin) => void;
  /** Shown in the palette when present. A function reflects current state. */
  label?: string | (() => string);
  /** Chords such as "mod+shift+g". "mod" is the Command key. */
  keys?: string[];
  hint?: string;
  keywords?: string;
  /** The shortcut also fires while typing in a field, always or only while this returns true. */
  inField?: boolean | (() => boolean);
  /** Hidden and unbound outside the desktop app. */
  desktop?: boolean;
  /** Unavailable until a note is open. */
  needsNote?: boolean;
  /** Offered in the palette only while this holds. */
  when?: () => boolean;
}

const SHIFTED: Record<string, string> = { "{": "[", "}": "]", "+": "=" };

/** The chord a key press spells, in the same form as `Command.keys`. */
export function chordOf(e: KeyboardEvent): string {
  const key = e.code === "Backslash" ? "\\" : (SHIFTED[e.key] ?? e.key.toLowerCase());
  return [e.ctrlKey && "ctrl", e.metaKey && "mod", e.altKey && "alt", e.shiftKey && "shift", key].filter(Boolean).join("+");
}

export function labelOf(command: Command): string | null {
  const { label } = command;
  if (label === undefined) return null;
  return typeof label === "function" ? label() : label;
}

const MENU_ECHO_MS = 250;

export class CommandTable {
  private readonly byId = new Map<string, Command>();
  private readonly byChord = new Map<string, Command>();
  private lastKey: { id: string; at: number } | null = null;

  constructor(
    readonly all: readonly Command[],
    private readonly env: { desktop: boolean; hasNote: () => boolean },
  ) {
    for (const command of all) {
      this.byId.set(command.id, command);
      if (command.desktop && !env.desktop) continue;
      for (const chord of command.keys ?? []) this.byChord.set(chord, command);
    }
  }

  run(id: string, origin: Origin): void {
    const command = this.byId.get(id);
    if (command && (!command.needsNote || this.env.hasNote())) command.run(origin);
  }

  /** Runs the command bound to this key press. Returns whether one ran. */
  handleKey(e: KeyboardEvent, inField: boolean): boolean {
    /* In a table cell F2 belongs to the grid: it switches between editing and moving. */
    if (e.key === "F2" && e.target instanceof HTMLElement && e.target.closest(".cm-table-widget")) return false;
    const command = this.byChord.get(chordOf(e));
    if (!command || (command.needsNote && !this.env.hasNote())) return false;
    if (inField && !(typeof command.inField === "function" ? command.inField() : command.inField)) return false;
    this.lastKey = { id: command.id, at: performance.now() };
    command.run("key");
    return true;
  }

  /** Whether the command can run right now. */
  canRun(id: string): boolean {
    const command = this.byId.get(id);
    return !!command && (!command.needsNote || this.env.hasNote()) && (!command.when || command.when());
  }

  keysOf(id: string): readonly string[] {
    return this.byId.get(id)?.keys ?? [];
  }

  /** A menu choice. The key press that also matched this command has already run it. */
  runFromMenu(id: string): void {
    if (this.lastKey?.id === id && performance.now() - this.lastKey.at < MENU_ECHO_MS) return;
    markKeyboardOrigin();
    this.run(id, "click");
  }

  /** Commands the palette may offer right now, in table order. */
  listed(): Command[] {
    return this.all.filter(
      (c) =>
        c.label !== undefined && (!c.desktop || this.env.desktop) && (!c.needsNote || this.env.hasNote()) && (c.when?.() ?? true),
    );
  }
}
