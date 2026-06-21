// ops/marks.js — page marks (pdf-lib): watermark, page numbers, Bates numbering,
// header/footer text. All draw onto existing pages (mutate in place); the runner
// normalizes through bytes afterward. Deterministic — no timestamps, no randomness.

import { getEngine } from '../core/engines.js';
import { winAnsiSafe } from './textsafe.js';

function lib() { return getEngine('pdf-lib'); }

function hexToRgb(hex, fallback = [0, 0, 0]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function resolvePages(doc, pages) {
  const count = doc.pageCount();
  if (!pages || !pages.length) return [...Array(count).keys()];
  for (const i of pages) if (i < 0 || i >= count) throw new Error(`Page ${i} out of range`);
  return pages;
}

async function helvetica(doc) {
  const { StandardFonts } = lib();
  return doc.pdf.embedFont(StandardFonts.Helvetica);
}

// position → {x,y} given page size, text width, font size, margin.
function place(position, pw, ph, tw, fs, margin = 28) {
  const left = margin, right = pw - tw - margin, center = (pw - tw) / 2;
  const bottom = margin, top = ph - fs - margin / 2;
  const map = {
    'bottom-center': [center, bottom], 'bottom-left': [left, bottom], 'bottom-right': [right, bottom],
    'top-center': [center, top], 'top-left': [left, top], 'top-right': [right, top],
  };
  return map[position] || map['bottom-center'];
}

export const ops = [
  {
    id: 'marks.watermark', label: 'Watermark', group: 'marks', icon: 'info',
    description: 'Draw a diagonal text watermark across the given pages (all pages if omitted).',
    agentCallable: true,
    params: {
      text: { type: 'string', required: true, maxLength: 200 },
      opacity: { type: 'number', default: 0.18, min: 0.02, max: 1 },
      fontSize: { type: 'number', default: 60, min: 6, max: 400 },
      color: { type: 'string', default: '#888888' },
      pages: { type: 'array', items: { type: 'int', min: 0 } },
    },
    async run(doc, { text, opacity, fontSize, color, pages }) {
      const { rgb, degrees } = lib();
      const font = await helvetica(doc);
      const [r, g, b] = hexToRgb(color, [0.53, 0.53, 0.53]);
      const ps = doc.pdf.getPages();
      for (const i of resolvePages(doc, pages)) {
        const page = ps[i];
        const { width, height } = page.getSize();
        const safe = winAnsiSafe(text);
        const tw = font.widthOfTextAtSize(safe, fontSize);
        // Center the rotated text roughly on the page diagonal.
        page.drawText(safe, {
          x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4),
          y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
          size: fontSize, font, color: rgb(r, g, b), opacity, rotate: degrees(45),
        });
      }
      return { doc };
    },
  },

  {
    id: 'marks.pageNumbers', label: 'Page numbers', group: 'marks', icon: 'info',
    description: 'Stamp page numbers. format uses {n} and {total} (e.g. "{n} / {total}").',
    agentCallable: true,
    params: {
      format: { type: 'string', default: '{n}', maxLength: 40 },
      position: { type: 'string', default: 'bottom-center', enum: ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'] },
      fontSize: { type: 'number', default: 11, min: 5, max: 48 },
      startAt: { type: 'int', default: 1 },
      color: { type: 'string', default: '#444444' },
    },
    async run(doc, { format, position, fontSize, startAt, color }) {
      const { rgb } = lib();
      const font = await helvetica(doc);
      const [r, g, b] = hexToRgb(color, [0.27, 0.27, 0.27]);
      const ps = doc.pdf.getPages();
      const total = ps.length;
      ps.forEach((page, idx) => {
        const label = winAnsiSafe(format.replace(/\{n\}/g, String(startAt + idx)).replace(/\{total\}/g, String(total)));
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(label, fontSize);
        const [x, y] = place(position, width, height, tw, fontSize);
        page.drawText(label, { x, y, size: fontSize, font, color: rgb(r, g, b) });
      });
      return { doc };
    },
  },

  {
    id: 'marks.bates', label: 'Bates numbering', group: 'marks', icon: 'info',
    description: 'Stamp sequential Bates numbers (prefix + zero-padded counter) for legal/discovery use.',
    agentCallable: true,
    params: {
      prefix: { type: 'string', default: '', maxLength: 40 },
      startAt: { type: 'int', default: 1, min: 0 },
      digits: { type: 'int', default: 6, min: 1, max: 12 },
      position: { type: 'string', default: 'bottom-right', enum: ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'] },
      fontSize: { type: 'number', default: 10, min: 5, max: 48 },
    },
    async run(doc, { prefix, startAt, digits, position, fontSize }) {
      const { rgb } = lib();
      const font = await helvetica(doc);
      const ps = doc.pdf.getPages();
      ps.forEach((page, idx) => {
        const label = winAnsiSafe(`${prefix}${String(startAt + idx).padStart(digits, '0')}`);
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(label, fontSize);
        const [x, y] = place(position, width, height, tw, fontSize);
        page.drawText(label, { x, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
      });
      return { doc };
    },
  },

  {
    id: 'marks.text', label: 'Header / footer', group: 'marks', icon: 'info',
    description: 'Stamp a fixed header or footer text at the given position on every page.',
    agentCallable: true,
    params: {
      text: { type: 'string', required: true, maxLength: 200 },
      position: { type: 'string', default: 'top-center', enum: ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'] },
      fontSize: { type: 'number', default: 11, min: 5, max: 48 },
      color: { type: 'string', default: '#444444' },
    },
    async run(doc, { text, position, fontSize, color }) {
      const { rgb } = lib();
      const font = await helvetica(doc);
      const [r, g, b] = hexToRgb(color, [0.27, 0.27, 0.27]);
      const safe = winAnsiSafe(text);
      for (const page of doc.pdf.getPages()) {
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(safe, fontSize);
        const [x, y] = place(position, width, height, tw, fontSize);
        page.drawText(safe, { x, y, size: fontSize, font, color: rgb(r, g, b) });
      }
      return { doc };
    },
  },
];
