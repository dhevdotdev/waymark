const SHOW_DELAY_MS = 550;
const WARM_MS = 800;

/** Shows `data-tip` labels under `root`. A tooltip opened soon after another skips the delay. */
export function bindTooltips(root: HTMLElement): void {
  let tip: HTMLElement | null = null;
  let timer = 0;
  let warmUntil = 0;

  const hide = () => {
    clearTimeout(timer);
    tip?.remove();
    tip = null;
  };

  const show = (target: HTMLElement) => {
    tip = document.createElement("div");
    tip.className = `tooltip${performance.now() < warmUntil ? " is-instant" : ""}`;
    tip.textContent = target.dataset.tip ?? "";
    if (target.dataset.key) {
      const kbd = document.createElement("kbd");
      kbd.textContent = target.dataset.key;
      tip.append(kbd);
    }
    document.body.append(tip);
    const r = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2))}px`;
    tip.style.top = `${r.bottom + 40 > window.innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
  };

  root.addEventListener("pointerover", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (!target || target.closest(".tab.is-active")) return;
    const label = target.querySelector<HTMLElement>(":scope > :is(.nav-text, .rail-link-name, .tree-name, .start-title)");
    if (label && label.scrollWidth <= label.clientWidth) return;
    if (target.classList.contains("tab")) {
      const title = target.querySelector<HTMLElement>(".tab-title");
      if (title && title.scrollWidth <= title.clientWidth) return;
    }
    hide();
    if (performance.now() < warmUntil) show(target);
    else timer = window.setTimeout(() => show(target), SHOW_DELAY_MS);
  });

  root.addEventListener("pointerout", (e) => {
    const from = (e.target as HTMLElement).closest("[data-tip]");
    if (from && !from.contains(e.relatedTarget as Node)) {
      if (tip) warmUntil = performance.now() + WARM_MS;
      hide();
    }
  });

  root.addEventListener("pointerdown", hide);
}
