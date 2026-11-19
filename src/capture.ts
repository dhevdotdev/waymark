import "./styles/capture.css";
import { type CaptureAnswer, isDesktop, native } from "./platform";
import { PrefStore } from "./prefs";
import { applyTheme, findFamily } from "./themes";

/** Long enough to read where the note went, while the app before already has the keyboard back. */
const LINGER_MS = 1100;
const ANSWER_LIMIT_MS = 4000;
const KEYS = "Return saves, Esc cancels";

type State = "editing" | "saving" | "saved" | "problem";

const root = document.getElementById("capture")!;
root.innerHTML = `<textarea class="capture-field" rows="3" placeholder="Write it down" aria-label="Quick capture"></textarea>
  <footer class="capture-foot"><span class="capture-status" role="status"></span><span class="capture-keys">${KEYS}</span></footer>`;
const field = root.querySelector<HTMLTextAreaElement>(".capture-field")!;
const status = root.querySelector<HTMLElement>(".capture-status")!;
const prefs = new PrefStore();
let state: State = "editing";
let asked = 0;
let waiting: { id: number; timer: number } | null = null;

function enter(next: State, message = ""): void {
  state = next;
  root.dataset.state = next;
  status.textContent = message;
  field.readOnly = next === "saving" || next === "saved";
}

async function applyPrefs(): Promise<void> {
  await prefs.load();
  const { appearance, family } = prefs.value;
  const dark = appearance === "dark" || (appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  applyTheme(findFamily(family), dark ? "dark" : "light");
}

function close(lingerMs: number, returnFocus: boolean): void {
  if (isDesktop) void native.closeCapture(lingerMs, returnFocus);
}

function cancel(): void {
  field.value = "";
  enter("editing");
  close(0, true);
}

function submit(): void {
  const text = field.value;
  if (!text.trim()) {
    cancel();
    return;
  }
  const id = ++asked;
  enter("saving");
  waiting = {
    id,
    timer: window.setTimeout(() => answered({ id, problem: "Waymark did not answer, so nothing was saved." }), ANSWER_LIMIT_MS),
  };
  void native.askToCapture({ id, text }).catch(() => answered({ id, problem: "Waymark did not answer, so nothing was saved." }));
}

function answered(answer: CaptureAnswer): void {
  if (!waiting || answer.id !== waiting.id) return;
  clearTimeout(waiting.timer);
  waiting = null;
  if ("problem" in answer) {
    enter("problem", answer.problem);
    field.focus();
    return;
  }
  const name = answer.saved.slice(answer.saved.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const folder = answer.saved.includes("/") ? answer.saved.slice(0, answer.saved.lastIndexOf("/")) : "";
  enter("saved", folder ? `Saved “${name}” in ${folder}` : `Saved “${name}”`);
  close(LINGER_MS, true);
}

/** Each showing starts from a clear field, unless the last one was put away with text still in it. */
function opened(): void {
  if (state === "saved") field.value = "";
  if (state !== "editing") enter("editing");
  void applyPrefs();
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

field.addEventListener("keydown", (e) => {
  if (e.isComposing) return;
  if (e.key === "Escape") {
    e.preventDefault();
    cancel();
  } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (state === "editing" || state === "problem") submit();
  }
});
field.addEventListener("input", () => {
  if (state === "problem") enter("editing");
});
/* Clicking into another app puts the window away and keeps what was typed for next time. */
window.addEventListener("blur", () => {
  if (state === "editing" || state === "problem") close(0, false);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void applyPrefs());
void native.onCaptureEvent("capture-open", opened);
void native.onCaptureEvent("capture-saved", (payload) => answered(payload as CaptureAnswer));
enter("editing");
void applyPrefs();
