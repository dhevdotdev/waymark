import { holdModal } from "./modal-layer";
import { fadeOut } from "./overlays";

let described = 0;

/** Puts `content` over the page, which stays out of reach until `close`, and describes it by `description`. */
function overlayFor(
  content: HTMLElement,
  description: HTMLElement,
  onEscape: () => void,
): { overlay: HTMLElement; close: () => void } {
  description.id = `prompt-note-${++described}`;
  content.setAttribute("aria-describedby", description.id);
  const overlay = document.createElement("div");
  overlay.className = "overlay prompt-overlay";
  overlay.append(content);
  document.body.append(overlay);
  const release = holdModal(overlay, { escape: onEscape });
  return {
    overlay,
    close: () => {
      fadeOut(overlay);
      release();
    },
  };
}

/** Asks for a short piece of text. `validate` returns why a value cannot be used. Resolves null if cancelled. */
export function promptText(options: {
  title: string;
  value?: string;
  hint?: string;
  action: string;
  validate: (value: string) => string | null;
}): Promise<string | null> {
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
    const { overlay, close } = overlayFor(form, note, () => finish(null));
    const finish = (value: string | null) => {
      close();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) finish(null);
    });
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
    const { overlay, close } = overlayFor(box, body, () => finish(false));
    const finish = (value: boolean) => {
      close();
      window.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const buttons = [cancel, confirm];
    const onKey = (e: KeyboardEvent) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Enter" && at < 0) {
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
