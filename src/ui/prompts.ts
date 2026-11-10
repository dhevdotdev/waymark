import { fadeOut } from "./overlays";

function overlayFor(content: HTMLElement): { overlay: HTMLElement; close: () => void } {
  const overlay = document.createElement("div");
  overlay.className = "overlay prompt-overlay";
  overlay.append(content);
  document.body.append(overlay);
  return { overlay, close: () => fadeOut(overlay) };
}

/** Holds Tab inside a dialog, wrapping at the ends of its controls. */
function holdTab(e: KeyboardEvent, controls: HTMLElement[]): void {
  e.preventDefault();
  e.stopPropagation();
  const at = controls.indexOf(document.activeElement as HTMLElement);
  const step = e.shiftKey ? -1 : 1;
  const from = at < 0 && e.shiftKey ? 0 : at;
  controls[(from + step + controls.length) % controls.length].focus();
}

/** Asks for a short piece of text. `validate` returns why a value cannot be used. Resolves null if cancelled. */
export function promptText(options: {
  title: string;
  value?: string;
  hint?: string;
  action: string;
  validate: (value: string) => string | null;
}): Promise<string | null> {
  const returnFocus = document.activeElement;
  return new Promise((resolve) => {
    const form = document.createElement("form");
    form.className = "prompt";
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-modal", "true");
    form.setAttribute("aria-label", options.title);
    const title = document.createElement("h2");
    title.className = "prompt-title";
    title.textContent = options.title;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.value = options.value ?? "";
    input.setAttribute("aria-label", options.title);
    const note = document.createElement("p");
    note.className = "prompt-note";
    note.textContent = options.hint ?? "";
    const actions = document.createElement("div");
    actions.className = "prompt-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn-primary";
    submit.textContent = options.action;
    actions.append(cancel, submit);
    form.append(title, input, note, actions);
    const { overlay, close } = overlayFor(form);
    const finish = (value: string | null) => {
      close();
      window.removeEventListener("keydown", onKey, true);
      if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) finish(null);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(null);
      } else if (e.key === "Tab") holdTab(e, [input, cancel, submit]);
    };
    window.addEventListener("keydown", onKey, true);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      const problem = options.validate(value);
      if (problem) {
        note.textContent = problem;
        note.classList.add("is-problem");
        return;
      }
      finish(value);
    });
    input.focus();
    input.select();
  });
}

/** Asks before something the user would want to think about. */
export function confirmAction(options: { title: string; body: string; action: string; danger?: boolean }): Promise<boolean> {
  const returnFocus = document.activeElement;
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "prompt";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.tabIndex = -1;
    const title = document.createElement("h2");
    title.className = "prompt-title";
    title.textContent = options.title;
    const body = document.createElement("p");
    body.className = "prompt-note";
    body.textContent = options.body;
    const actions = document.createElement("div");
    actions.className = "prompt-actions";
    const cancel = document.createElement("button");
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.className = options.danger ? "btn btn-danger" : "btn btn-primary";
    confirm.textContent = options.action;
    actions.append(cancel, confirm);
    box.append(title, body, actions);
    box.setAttribute("aria-label", options.title);
    box.setAttribute("aria-description", options.body);
    const { overlay, close } = overlayFor(box);
    const finish = (value: boolean) => {
      close();
      window.removeEventListener("keydown", onKey, true);
      if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
      resolve(value);
    };
    const buttons = [cancel, confirm];
    const onKey = (e: KeyboardEvent) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Tab") holdTab(e, buttons);
      else if (e.key === "Enter" && at < 0) {
        e.preventDefault();
        e.stopPropagation();
        /* Return never takes a destructive action unless that button was reached on purpose. */
        if (options.danger) cancel.focus();
        else finish(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) finish(false);
    });
    box.focus({ preventScroll: true });
  });
}
