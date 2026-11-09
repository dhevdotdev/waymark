import { dismissOnOutside } from "./overlays";

export interface MenuItem {
  label: string;
  run: () => void;
}

/** A small menu at the pointer. It closes on a choice, Escape or a press anywhere else. */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "popover context-menu";
  menu.setAttribute("role", "menu");
  const stop = dismissOnOutside([menu], () => menu.remove());
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "context-item";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.addEventListener("click", () => {
      stop();
      menu.remove();
      item.run();
    });
    menu.append(button);
  }
  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
}
