import { dismissOnOutside, fadeOut, toast } from "./overlays";

const STATUS_BAR_ROOM = 40;

export interface MenuItem {
  label: string;
  run: () => void;
  /** Draws a line above this item. */
  startsGroup?: boolean;
  /** Marks something that removes the thing it acts on. */
  danger?: boolean;
  /** A keyboard shortcut shown at the end of the row. */
  hint?: string;
  checked?: boolean;
  /** Why this cannot happen right now. The item stays in the menu and says so. */
  blocked?: string | null;
}

export interface MenuOptions {
  /** Puts the menu's right edge at `x` instead of its left edge. */
  alignEnd?: boolean;
  onClose?: () => void;
  /** Chooses where the menu goes once its size is known, and the corner it grows from if that is not the `x`, `y` point. */
  place?: (width: number, height: number) => readonly [left: number, top: number, origin?: string];
  /** Opened from the keyboard, so the first item takes focus. */
  keyboard?: boolean;
}

function buildItem(item: MenuItem, activate: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `context-item${item.danger ? " is-danger" : ""}`;
  button.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemradio");
  if (item.checked !== undefined) button.setAttribute("aria-checked", String(item.checked));
  const label = document.createElement("span");
  label.textContent = item.label;
  button.append(label);
  if (item.blocked) {
    button.classList.add("is-blocked");
    button.setAttribute("aria-disabled", "true");
  }
  const end = item.checked ? null : (item.blocked ?? item.hint);
  if (end) {
    const hint = document.createElement("span");
    hint.className = "context-hint";
    hint.textContent = end;
    button.append(hint);
  }
  button.addEventListener("click", () => {
    if (item.blocked) toast(item.blocked);
    else activate();
  });
  return button;
}

/** Arrow, Home and End move through a menu whether or not it took focus when it opened. */
function bindMenuKeys(menu: HTMLElement, leave: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    const items = [...menu.querySelectorAll<HTMLElement>(".context-item")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at <= 0 ? items.length : at) - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (e.key === "Tab") {
      e.preventDefault();
      leave();
    } else if (e.key in moves) {
      e.preventDefault();
      items[moves[e.key]]?.focus();
    } else if (e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const letter = e.key.toLowerCase();
      const ordered = [...items.slice(at + 1), ...items.slice(0, at + 1)];
      ordered.find((item) => item.textContent?.toLowerCase().startsWith(letter))?.focus();
    } else if (at < 0 && !e.metaKey && !e.ctrlKey && e.key !== "Escape") {
      e.preventDefault();
    } else {
      return;
    }
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

/** A small menu at the pointer. It closes on a choice, Escape or a press anywhere else. */
export function showContextMenu(x: number, y: number, items: MenuItem[], options: MenuOptions = {}): void {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "popover context-menu";
  menu.setAttribute("role", "menu");
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    stopKeys();
    fadeOut(menu);
    options.onClose?.();
  };
  const giveFocusBack = () => {
    if (menu.contains(document.activeElement)) opener?.focus({ preventScroll: true });
  };
  const stop = dismissOnOutside([menu], (e) => {
    if (e instanceof KeyboardEvent) giveFocusBack();
    close();
  });
  const stopKeys = bindMenuKeys(menu, () => {
    stop();
    giveFocusBack();
    close();
  });
  for (const item of items) {
    if (item.startsGroup) {
      const line = document.createElement("div");
      line.className = "context-line";
      line.setAttribute("role", "separator");
      menu.append(line);
    }
    menu.append(
      buildItem(item, () => {
        stop();
        close();
        item.run();
      }),
    );
  }
  document.body.append(menu);
  const { offsetWidth: width, offsetHeight: height } = menu;
  const [placedLeft, placedTop, origin] = options.place?.(width, height) ?? [options.alignEnd ? x - width : x, y];
  const left = Math.max(8, Math.min(placedLeft, innerWidth - width - 8));
  const top = Math.max(8, Math.min(placedTop, innerHeight - height - STATUS_BAR_ROOM));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.transformOrigin =
    origin ?? `${Math.max(0, Math.min(width, x - left))}px ${Math.max(0, Math.min(height, y - top))}px`;
  if (options.keyboard) menu.querySelector<HTMLElement>(".context-item")?.focus();
}
