import { type PropertyValue, parseFrontmatter } from "../vault/frontmatter";
import { addProperty, type Property, type PropertySheet, readSheet, removeProperty, setList, setText } from "../vault/properties";
import { icons } from "./icons";
import { isPointerAction } from "./input-origin";
import { arrive, flashLanded, glide, holdClassWhile, type Place, placesOf, timing } from "./list-motion";
import { reducedMotion } from "./media";
import type { WriteResult } from "./note-writer";

export interface PropertyHost {
  write: (path: string, edit: (text: string) => string | null) => Promise<WriteResult>;
  text: (path: string) => Promise<string>;
  /** A change added or removed lines, so whatever was drawn from the old text has stale line numbers. */
  linesMoved: () => void;
  openRaw: (path: string, line: number) => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
}

const MESSAGES: Record<Exclude<WriteResult["kind"], "done" | "failed">, string> = {
  refused: "That property can't be changed here. Open the note as text to change it.",
  changed: "This note just changed elsewhere, so your change was left out.",
  busy: "Syncing right now. Try again in a moment.",
};

const button = (className: string, label: string, content: string) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.setAttribute("aria-label", label);
  el.innerHTML = content;
  return el;
};

/** A note's properties in the panel: every value changes where it sits, and the file changes only on that property's lines. */
export class PropertyEditor {
  readonly root = document.createElement("div");
  private readonly list = document.createElement("dl");
  private readonly adder = button("link-btn prop-add", "Add property", "Add property");
  private path = "";
  private text = "";
  private sheet: PropertySheet = { properties: [], canAdd: false };
  private editing = false;
  private waiting: { path: string; text: string } | null = null;

  constructor(private readonly host: PropertyHost) {
    this.root.className = "prop-editor";
    this.list.className = "props";
    this.root.append(this.list, this.adder);
    this.adder.addEventListener("click", () => this.beginAdd());
  }

  /** A change arriving mid-edit waits, so what is being typed is not pulled away. */
  show(path: string, text: string): void {
    if (path === this.path && text === this.text) return;
    if (this.editing && path === this.path) {
      this.waiting = { path, text };
      return;
    }
    this.path = path;
    this.text = text;
    this.sheet = readSheet(text);
    this.draw(text);
  }

  private took(text: string): void {
    const lines = (of: string) => of.split("\n").length;
    const moved = lines(text) !== lines(this.text);
    this.text = text;
    this.sheet = readSheet(text);
    if (moved) this.host.linesMoved();
  }

  private draw(text: string): void {
    this.list.replaceChildren();
    const { properties, canAdd } = this.sheet;
    if (properties.length) for (const property of properties) this.drawRow(property);
    else if (!canAdd) for (const [key, value] of Object.entries(parseFrontmatter(text).data)) this.drawFixed(key, value, 0);
    this.adder.hidden = !canAdd;
  }

  private row(key: string): HTMLElement {
    const dt = document.createElement("dt");
    dt.className = "prop-key";
    dt.textContent = key;
    dt.dataset.tip = key;
    const dd = document.createElement("dd");
    dd.className = "prop-cell";
    dd.dataset.key = key;
    this.list.append(dt, dd);
    return dd;
  }

  private drawRow(property: Property): void {
    if (property.form === "fixed") this.drawFixed(property.key, property.value, property.line);
    else if (property.form === "list") this.drawList(property);
    else this.drawText(property);
  }

  private drawFixed(key: string, value: PropertyValue, line: number): void {
    const cell = this.row(key);
    cell.classList.add("is-fixed");
    const shown = document.createElement("span");
    shown.className = "prop-fixed";
    shown.textContent = Array.isArray(value) ? value.join(", ") : value;
    const raw = button("link-btn prop-raw", `Open ${key} as text`, "Edit as text");
    raw.addEventListener("click", () => this.host.openRaw(this.path, line));
    cell.append(shown, raw);
  }

  private removeControl(key: string): HTMLElement {
    const remove = button("prop-remove", `Remove ${key}`, icons.close);
    remove.addEventListener("click", () => void this.remove(key));
    return remove;
  }

  private drawText({ key, value }: Property): void {
    const cell = this.row(key);
    const shown = document.createElement("span");
    shown.className = "prop-value";
    shown.tabIndex = 0;
    shown.setAttribute("role", "button");
    shown.setAttribute("aria-label", `Change ${key}`);
    shown.textContent = typeof value === "string" ? value : "";
    const begin = () => this.editInPlace(shown, (next) => this.commit((text) => setText(text, key, next), shown));
    shown.addEventListener("click", begin);
    shown.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === "F2") && !this.editing) {
        e.preventDefault();
        begin();
      }
    });
    cell.append(shown, this.removeControl(key));
  }

  private drawList(property: Property): void {
    const { key } = property;
    const items = property.value as string[];
    const cell = this.row(key);
    const chips = document.createElement("span");
    chips.className = "prop-chips";
    const save = (next: string[], changed: HTMLElement) => this.commit((text) => setList(text, key, next), changed, true);
    items.forEach((item, i) => {
      const chip = document.createElement("span");
      chip.className = "prop-chip";
      chip.tabIndex = 0;
      chip.setAttribute("role", "button");
      chip.setAttribute("aria-label", `Change ${item} in ${key}`);
      chip.textContent = item;
      const begin = () => this.editInPlace(chip, (next) => save(items.with(i, next), chip));
      chip.addEventListener("click", begin);
      chip.addEventListener("keydown", (e) => {
        if (this.editing) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          begin();
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          void save(items.toSpliced(i, 1), cell);
        }
      });
      chips.append(chip);
    });
    const more = button("prop-chip-add", `Add to ${key}`, icons.plus);
    more.addEventListener("click", () => {
      const chip = document.createElement("span");
      chip.className = "prop-chip";
      chips.insertBefore(chip, more);
      this.editInPlace(
        chip,
        (next) => (next ? save([...items, next], chip) : Promise.resolve(false)),
        () => chip.remove(),
      );
    });
    chips.append(more);
    cell.append(chips, this.removeControl(key));
  }

  /** The text stays where it is and becomes editable, so the row keeps its shape while typing. */
  private editInPlace(el: HTMLElement, commit: (text: string) => Promise<boolean>, dropped?: () => void): void {
    if (this.editing) return;
    this.editing = true;
    const old = el.textContent ?? "";
    el.contentEditable = "plaintext-only";
    el.dataset.editingProperty = "";
    el.focus();
    getSelection()?.selectAllChildren(el);
    const finish = (keep: boolean, refocus: boolean) => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeAttribute("contenteditable");
      delete el.dataset.editingProperty;
      const typed = (el.textContent ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
      this.editing = false;
      if (refocus) el.focus();
      if (!keep || typed === old) {
        el.textContent = old;
        if (!old) dropped?.();
        this.afterEdit();
        return;
      }
      el.textContent = typed;
      void commit(typed).then((saved) => {
        if (!saved) {
          el.textContent = old;
          if (!old) dropped?.();
          el.classList.remove("is-failed");
          void el.offsetWidth;
          el.classList.add("is-failed");
        }
        this.afterEdit();
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finish(true, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false, true);
      }
    };
    const onBlur = () => finish(true, false);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  private afterEdit(): void {
    if (!this.waiting || this.editing) return;
    const { path, text } = this.waiting;
    this.waiting = null;
    this.show(path, text);
  }

  /** Writes a change and says plainly when it did not happen. */
  private async write(edit: (text: string) => string | null): Promise<string | null> {
    const result = await this.host.write(this.path, edit);
    if (result.kind === "done") return result.text;
    this.host.toast(result.kind === "failed" ? result.message : MESSAGES[result.kind]);
    if (result.kind === "changed") {
      this.waiting = { path: this.path, text: await this.host.text(this.path) };
      this.afterEdit();
    }
    return null;
  }

  private async commit(edit: (text: string) => string | null, changed: HTMLElement, redraw = false): Promise<boolean> {
    const text = await this.write(edit);
    if (text === null) return false;
    this.took(text);
    if (redraw) this.drawKeepingFocus(text, changed);
    else flashLanded(changed);
    return true;
  }

  private drawKeepingFocus(text: string, near: HTMLElement): void {
    const key = near.closest<HTMLElement>("[data-key]")?.dataset.key;
    const was = placesOf(this.rows(), this.list);
    this.draw(text);
    this.settle(was);
    const cell = key ? this.cellOf(key) : null;
    if (cell) flashLanded(cell);
    cell?.querySelector<HTMLElement>(".prop-chip-add, .prop-value")?.focus({ preventScroll: true });
  }

  private cellOf(key: string): HTMLElement | null {
    return [...this.list.querySelectorAll<HTMLElement>("[data-key]")].find((c) => c.dataset.key === key) ?? null;
  }

  private rows(): Map<string, HTMLElement> {
    return new Map(
      [...this.list.querySelectorAll<HTMLElement>("dt, dd")].map((el) => [
        el.tagName === "DT" ? `dt:${el.textContent}` : `dd:${el.dataset.key}`,
        el,
      ]),
    );
  }

  /** After a pointer change the rows slide to their new places. The list clips them, so nothing below it has to move out of their way. */
  private settle(was: Map<string, Place>): void {
    if (!isPointerAction()) return;
    const rows = this.rows();
    const fade = timing("--t-menu", "--ease-out");
    for (const [key, el] of rows) if (!was.has(key)) arrive(el, fade);
    if (reducedMotion()) return;
    holdClassWhile(this.list, "is-settling", glide(rows, was, this.list, timing("--t-menu", "--ease-in-out")));
  }

  private async remove(key: string): Promise<void> {
    let before = "";
    const text = await this.write((current) => {
      before = current;
      return removeProperty(current, key);
    });
    if (text === null) return;
    this.redraw(text);
    this.adder.focus({ preventScroll: true });
    this.host.toast(`Removed ${key}`, { label: "Undo", run: () => void this.undoRemove(text, before) });
  }

  private async undoRemove(after: string, before: string): Promise<void> {
    const text = await this.write((current) => (current === after ? before : null));
    if (text !== null) this.redraw(text);
  }

  private redraw(text: string): void {
    const was = placesOf(this.rows(), this.list);
    this.took(text);
    this.draw(text);
    this.settle(was);
  }

  private beginAdd(): void {
    if (this.editing) return;
    this.editing = true;
    const form = document.createElement("div");
    form.className = "prop-new";
    const name = document.createElement("input");
    name.className = "prop-new-field";
    name.placeholder = "Name";
    name.setAttribute("aria-label", "Property name");
    const value = document.createElement("input");
    value.className = "prop-new-field";
    value.placeholder = "Value";
    value.setAttribute("aria-label", "Property value");
    const hint = document.createElement("p");
    hint.className = "prop-hint";
    hint.setAttribute("role", "status");
    form.append(name, value, hint);
    for (const field of [name, value]) field.spellcheck = false;
    this.adder.hidden = true;
    this.root.append(form);
    name.focus();

    const close = () => {
      form.remove();
      this.adder.hidden = !this.sheet.canAdd;
      this.editing = false;
      this.adder.focus({ preventScroll: true });
      this.afterEdit();
    };
    const submit = async () => {
      const key = name.value.trim();
      if (!key) {
        close();
        return;
      }
      if (this.sheet.properties.some((p) => p.key === key)) {
        hint.textContent = "This note already has that property.";
        name.focus();
        name.select();
        return;
      }
      const text = await this.write((current) => addProperty(current, key, value.value));
      if (text === null) {
        name.focus();
        return;
      }
      form.remove();
      this.adder.hidden = !this.sheet.canAdd;
      this.editing = false;
      this.redraw(text);
      const cell = this.cellOf(key);
      if (cell) flashLanded(cell);
      this.adder.focus({ preventScroll: true });
      this.afterEdit();
    };
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === name && name.value.trim()) value.focus();
        else void submit();
      }
    });
    form.addEventListener("focusout", (e) => {
      if (form.contains(e.relatedTarget as Node)) return;
      if (name.value.trim()) void submit();
      else close();
    });
  }
}
