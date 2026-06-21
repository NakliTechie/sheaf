// icons.js — one consistent icon family (24×24, stroke, suite-standard). Inline so
// the single-file build carries them; ARIA labels live on the buttons, not here.

const P = {
  open:    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  new:     '<path d="M14 3v5h5"/><path d="M6 3h8l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M12 11v6M9 14h6"/>',
  save:    '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>',
  saveas:  '<path d="M5 3h9l5 5v6"/><path d="M3 5a2 2 0 0 1 2-2"/><path d="M16 21v-5h5M18.5 18.5 21 21"/><path d="M7 3v5h7"/>',
  undo:    '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v1"/>',
  redo:    '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0-5 5v1"/>',
  rotate:  '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
  trash:   '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  copy:    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  reorder: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  insert:  '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
  extract: '<path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3"/><path d="M14 3h6v6M20 3l-8 8"/>',
  scale:   '<path d="M4 4h7v7H4z"/><path d="M14 14h6v6h-6z"/><path d="M11 4h9v9"/>',
  merge:   '<path d="M7 3v6a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v4"/><path d="M14 18l3 3 3-3M4 6l3-3 3 3"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  help:    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2.5 2-2.5 3.5M12 17h.01"/>',
  sun:     '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:    '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  pages:   '<rect x="4" y="3" width="14" height="18" rx="2"/><path d="M8 3v18"/>',
  zoomin:  '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M11 8v6M8 11h6"/>',
  zoomout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4M8 11h6"/>',
  mark:    '<path d="M20.6 8.5 8.4 20.7a2 2 0 0 1-1.7.6l-3-.4a1 1 0 0 1-.8-.8l-.4-3a2 2 0 0 1 .6-1.7L15.5 3.4a2 2 0 0 1 2.8 0l2.3 2.3a2 2 0 0 1 0 2.8z"/><path d="M14 5l5 5"/>',
  cursor:  '<path d="M5 3l5.5 16 2.2-6.5L19 10.3z"/>',
  highlight:'<path d="M3 21h6M9 14l-3 5 4-1 9-9-3-3-9 9z"/><path d="M14 7l3 3"/>',
  square:  '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
  line:    '<path d="M5 19 19 5"/>',
  textbox: '<path d="M4 6V4h16v2M9 20h6M12 4v16"/>',
  redact:  '<rect x="3" y="9" width="18" height="6" rx="1" fill="currentColor" stroke="none"/><path d="M3 5h18M3 19h18"/>',
  eraser:  '<path d="M7 21h13M5 13l6-6 7 7-6 6H8z"/><path d="M9 11l6 6"/>',
  forms:   '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
};

export function icon(name) {
  const body = P[name] || '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
