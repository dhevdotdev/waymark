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
  newNote: svg(`<path d="M4.5 2.5h4.6L12 5.4v8.1H4.5z"/><path d="M8.25 7.2v4M6.25 9.2h4"/>`),
  sun: svg(
    `<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1"/>`,
  ),
  moon: svg(`<path d="M12.8 9.8A5.3 5.3 0 0 1 6.2 3.2a5.3 5.3 0 1 0 6.6 6.6z"/>`),
  plus: svg(`<path d="M8 3.5v9M3.5 8h9"/>`),
  minus: svg(`<path d="M3.5 8h9"/>`),
  fit: svg(`<path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"/>`),
};
