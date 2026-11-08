const svg = (d: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;

/** One drawn set: 16px grid, 1.6 stroke, round caps. */
export const icons = {
  sidebar: svg(`<rect x="2" y="3" width="12" height="10" rx="2.2"/><path d="M6.5 3v10"/>`),
  back: svg(`<path d="M10 3.5 5.5 8l4.5 4.5"/>`),
  forward: svg(`<path d="M6 3.5 10.5 8 6 12.5"/>`),
  close: svg(`<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>`),
  search: svg(`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>`),
  inspector: svg(`<rect x="2" y="3" width="12" height="10" rx="2.2"/><path d="M9.5 3v10"/>`),
  branch: svg(
    `<circle cx="5" cy="3.8" r="1.5"/><circle cx="5" cy="12.2" r="1.5"/><circle cx="11" cy="5.5" r="1.5"/><path d="M5 5.3v5.4M11 7c0 2.2-3 2.2-6 3"/>`,
  ),
  graph: svg(
    `<circle cx="4" cy="11.5" r="1.8"/><circle cx="12" cy="11" r="1.8"/><circle cx="8.5" cy="4" r="1.8"/><path d="M5.3 10.2 7.6 5.6M10.9 9.6 9.4 5.5M5.8 11.4h4.4"/>`,
  ),
  sliders: svg(
    `<path d="M3 5h5.5M11.5 5H13M3 11h1.5M7.5 11H13"/><circle cx="10" cy="5" r="1.6"/><circle cx="6" cy="11" r="1.6"/>`,
  ),
  note: svg(`<path d="M4.5 2.5h4.6L12 5.4v8.1H4.5z"/><path d="M9 2.5v3h3"/>`),
  folder: svg(`<path d="M2.5 4.5a1 1 0 0 1 1-1h2.6l1.4 1.5h5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>`),
  plus: svg(`<path d="M8 3.5v9M3.5 8h9"/>`),
  minus: svg(`<path d="M3.5 8h9"/>`),
  fit: svg(`<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>`),
};
