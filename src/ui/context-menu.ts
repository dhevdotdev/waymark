import { dismissOnOutside } from "./overlays";

export interface MenuItem {
  label: string;
  run: () => void;
  /** Draws a line above this item. */
  startsGroup?: boolean;
}

export interface MenuOptions {
  /** Puts the menu's right edge at `x` instead of its left edge. */
  alignEnd?: boolean;
  onClose?: () => void;
}

/** A small menu at the pointer. It closes on a choice, Escape or a press anywhere else. */
export function showContextMenu(x: number, y: number, items: MenuItem[], options: MenuOptions = {}): void {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "popover context-menu";
  menu.setAttribute("role", "menu");
  const close = () => {
    menu.remove();
    options.onClose?.();
  };
  const stop = dismissOnOutside([menu], close);
  for (const item of items) {
    if (item.startsGroup) {
      const line = document.createElement("div");
      line.className = "context-line";
      line.setAttribute("role", "separator");
      menu.append(line);
    }
    const button = document.createElement("button");
    button.className = "context-item";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.addEventListener("click", () => {
      stop();
      close();
      item.run();
    });
    menu.append(button);
  }
  document.body.append(menu);
  const { offsetWidth: width, offsetHeight: height } = menu;
  const left = options.alignEnd ? x - width : x;
  menu.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
}
