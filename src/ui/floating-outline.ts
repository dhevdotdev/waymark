export interface OutlineHeading {
  level: number;
  text: string;
  id: string;
}

/** A dash per heading on the right edge, for reading with the inspector closed. Hovering opens the titles. */
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
  }

  setActive(index: number): void {
    if (index === this.active) return;
    this.links[this.active]?.classList.remove("is-active");
    this.links[index]?.classList.add("is-active");
    this.active = index;
    this.links[index]?.scrollIntoView({ block: "nearest" });
  }
}
