import { native } from "../platform";

const MODIFIERS = [
  ["Control", "⌃"],
  ["Alt", "⌥"],
  ["Shift", "⇧"],
  ["Command", "⌘"],
] as const;

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  Tab: "Tab",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

/** Keys that are only modifiers, or that the recorder keeps for itself. */
const NOT_A_KEY = /^(?:Shift|Control|Alt|Meta|OS|Fn|CapsLock|Escape|Backspace|Delete)/;

/** "Control+Alt+Space" as the menu bar writes it: ⌃⌥Space. */
export function shortcutLabel(accelerator: string): string {
  if (!accelerator) return "Off";
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const marks = MODIFIERS.filter(([name]) => parts.includes(name)).map(([, mark]) => mark);
  const shown = KEY_LABELS[key] ?? key.replace(/^Key|^Digit/, "");
  return `${marks.join("")}${shown}`;
}

/** The shortcut a key press asks for. It needs Control, Option or Command, so ordinary typing never sets one. */
export function acceleratorFrom(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (!e.code || NOT_A_KEY.test(e.code) || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  const held = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey];
  const names = MODIFIERS.filter((_, i) => held[i]).map(([name]) => name);
  return [...names, e.code].join("+");
}

let problem: string | null = null;

/** Why the saved shortcut is not working, for Settings to say, or null when it is. */
export function captureProblem(): string | null {
  return problem;
}

/** Tries a shortcut. Null means it now opens capture; otherwise the reason, and the one before keeps working. */
export async function tryCaptureShortcut(accelerator: string): Promise<string | null> {
  try {
    await native.setCaptureShortcut(accelerator);
    problem = null;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Registers the saved shortcut at launch, keeping any failure for Settings rather than interrupting. */
export async function startCaptureShortcut(accelerator: string): Promise<void> {
  problem = await tryCaptureShortcut(accelerator);
}

type Recording = { finish: (accelerator: string | null) => void };
let recording: Recording | null = null;

/*
 * Registered as this module loads, before the app adds its own shortcut handling, so while a shortcut is being recorded
 * the chord goes to the recorder and never also runs a command.
 */
window.addEventListener(
  "keydown",
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape") recording.finish(null);
    else if (e.key === "Backspace" || e.key === "Delete") recording.finish("");
    else {
      const accelerator = acceleratorFrom(e);
      if (accelerator) recording.finish(accelerator);
    }
  },
  true,
);

/** Waits for the next chord. Null means the recording was cancelled, and an empty string turns capture off. */
export function recordShortcut(): Promise<string | null> {
  recording?.finish(null);
  return new Promise((resolve) => {
    const current: Recording = {
      finish: (accelerator) => {
        if (recording === current) recording = null;
        resolve(accelerator);
      },
    };
    recording = current;
  });
}

export function stopRecording(): void {
  recording?.finish(null);
}
