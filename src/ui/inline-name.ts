export interface InlineNameOptions {
  value: string;
  label: string;
  problem: (value: string) => string | null;
  toast: (message: string) => void;
}

/**
 * Lets a name be typed where `row` sits in the tree. Enter or clicking away
 * accepts it and Escape cancels. Resolves with the new name, or null if
 * nothing should change.
 */
export function nameInPlace(row: HTMLElement, options: InlineNameOptions): Promise<string | null> {
  const { value, label, problem, toast } = options;
  const editor = document.createElement("div");
  editor.className = "nav-item is-naming";
  editor.style.setProperty("--d", row.style.getPropertyValue("--d"));
  const icon = row.querySelector(".tree-icon");
  if (icon) editor.append(icon.cloneNode(true));
  const input = document.createElement("input");
  input.className = "tree-name-input";
  input.type = "text";
  input.spellcheck = false;
  input.value = value;
  input.setAttribute("aria-label", label);
  editor.append(input);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      editor.replaceWith(row);
      resolve(result);
    };
    const typed = () => input.value.trim();
    const accepted = () => typed() !== "" && typed() !== value;
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") finish(null);
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!accepted()) return finish(null);
      const reason = problem(typed());
      input.classList.toggle("is-problem", reason !== null);
      if (reason) toast(reason);
      else finish(typed());
    });
    input.addEventListener("blur", () => finish(accepted() && problem(typed()) === null ? typed() : null));
    row.replaceWith(editor);
    input.focus();
    input.select();
  });
}
