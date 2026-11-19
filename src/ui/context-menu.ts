import { bindMenuKeys } from "./menu-keys";
import { returnFocus, takeFocus } from "./modal-layer";
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
  /** What the menu acts on, for its accessible name. */
  label?: string;
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

let closeOpen: (() => void) | null = null;

/** A small menu at the pointer. It closes on a choice, Escape or a press anywhere else. */
export function showContextMenu(x: number, y: number, items: MenuItem[], options: MenuOptions = {}): void {
  closeOpen?.();
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "popover context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", options.label ?? "Actions");
  const opener = document.activeElement;
  const close = () => {
    closeOpen = null;
    stop();
    stopKeys();
    returnFocus(opener, menu);
    fadeOut(menu);
    options.onClose?.();
  };
  closeOpen = close;
  const stop = dismissOnOutside([menu], close);
  const stopKeys = bindMenuKeys(
    () => [...menu.querySelectorAll<HTMLElement>(".context-item")],
    (item) => item.firstElementChild?.textContent ?? "",
    close,
  );
  for (const item of items) {
    if (item.startsGroup) {
      const line = document.createElement("div");
      line.className = "context-line";
      line.setAttribute("role", "separator");
      menu.append(line);
    }
    menu.append(
      buildItem(item, () => {
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
  takeFocus(menu.querySelector<HTMLElement>(".context-item:not(.is-blocked)"));
}
