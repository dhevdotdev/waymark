const SPY_OFFSET = 96;

export interface OutlineHeading {
  level: number;
  text: string;
  id: string;
}

/** The note's outline: a dash per heading on the right edge. Hovering opens the titles. */
export class FloatingOutline {
  readonly root = document.createElement("nav");
  private links: HTMLAnchorElement[] = [];
  private active = -1;

  constructor() {
    this.root.className = "floating-outline";
    this.root.setAttribute("aria-label", "Headings in this note");
    this.root.hidden = true;
  }

  render(headings: OutlineHeading[]): void {
    this.active = -1;
    this.links = headings.map((heading) => {
      const a = document.createElement("a");
      a.href = `#${heading.id}`;
      a.className = `fo-item l${heading.level}`;
      a.dataset.target = heading.id;
      const dash = document.createElement("span");
      dash.className = "fo-dash";
      const label = document.createElement("span");
      label.className = "fo-label";
      label.textContent = heading.text.replace(/`/g, "");
      a.append(label, dash);
      return a;
    });
    this.root.replaceChildren(...this.links);
    this.root.hidden = this.links.length < 2;
    this.markFolds();
  }

  /** Shows which sections are folded, and dims the headings folded away inside them. */
  markFolds(): void {
    for (const link of this.links) {
      const heading = document.getElementById(link.dataset.target!);
      link.classList.toggle("is-folded", heading?.hasAttribute("data-folded") ?? false);
      link.classList.toggle("is-hidden", heading?.hasAttribute("data-fold-hidden") ?? false);
    }
  }

  /** Marks the heading being read. */
  spy(scroller: HTMLElement): void {
    if (!this.links.length) return;
    const line = scroller.getBoundingClientRect().top + SPY_OFFSET;
    let current = 0;
    this.links.forEach((link, i) => {
      const heading = document.getElementById(link.dataset.target!);
      if (heading && !heading.hasAttribute("data-fold-hidden") && heading.getBoundingClientRect().top <= line) current = i;
    });
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && scroller.scrollTop > 0;
    this.setActive(atEnd ? this.links.length - 1 : current);
  }

  private setActive(index: number): void {
    if (index === this.active) return;
    this.links[this.active]?.classList.remove("is-active");
    this.links[index]?.classList.add("is-active");
    this.active = index;
    this.links[index]?.scrollIntoView({ block: "nearest" });
  }
}
