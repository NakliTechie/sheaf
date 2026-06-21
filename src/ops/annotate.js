// ops/annotate.js — annotations drawn onto the page content (pdf-lib). Coordinates
// are NORMALIZED (0..1 fractions of page width/height, screen orientation: y down
// from the top). The op converts to PDF points (origin bottom-left), so the same op
// is scale- and zoom-independent — the interaction layer just captures fractions.
//
// These are content draws (flattened into the page), not interactive PDF annotation
// objects — consistent with the deterministic, replayable substrate.

import { getEngine } from '../core/engines.js';

function lib() { return getEngine('pdf-lib'); }

function hexToRgb(hex, fallback = [0, 0, 0]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function pageOf(doc, i) {
  const count = doc.pageCount();
  if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`Page ${i} out of range (0..${count - 1})`);
  return doc.pdf.getPages()[i];
}

// Normalized rect (top-left x,y + w,h, all 0..1) → pdf-lib rect (bottom-left origin).
function rectToPdf(page, x, y, w, h) {
  const { width: W, height: H } = page.getSize();
  return { x: x * W, y: H * (1 - (y + h)), width: w * W, height: h * H };
}
function ptToPdf(page, x, y) {
  const { width: W, height: H } = page.getSize();
  return { x: x * W, y: H * (1 - y) };
}

export const ops = [
  {
    id: 'annotate.highlight', label: 'Highlight', group: 'annotate', icon: 'highlight',
    description: 'Draw a translucent highlight rectangle over a region (normalized 0..1 coords).',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      w: { type: 'number', required: true }, h: { type: 'number', required: true },
      color: { type: 'string', default: '#ffe14d' }, opacity: { type: 'number', default: 0.4, min: 0.05, max: 1 },
    },
    run(doc, p) {
      const { rgb } = lib();
      const page = pageOf(doc, p.page);
      const r = rectToPdf(page, p.x, p.y, p.w, p.h);
      const [cr, cg, cb] = hexToRgb(p.color, [1, 0.88, 0.3]);
      page.drawRectangle({ ...r, color: rgb(cr, cg, cb), opacity: p.opacity });
      return { doc };
    },
  },

  {
    id: 'annotate.rect', label: 'Rectangle', group: 'annotate', icon: 'square',
    description: 'Draw a rectangle outline (optionally filled) over a region.',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      w: { type: 'number', required: true }, h: { type: 'number', required: true },
      color: { type: 'string', default: '#ff3b30' }, thickness: { type: 'number', default: 2, min: 0.25, max: 40 },
      fill: { type: 'bool', default: false }, fillOpacity: { type: 'number', default: 0.2, min: 0, max: 1 },
    },
    run(doc, p) {
      const { rgb } = lib();
      const page = pageOf(doc, p.page);
      const r = rectToPdf(page, p.x, p.y, p.w, p.h);
      const [cr, cg, cb] = hexToRgb(p.color, [1, 0.23, 0.19]);
      page.drawRectangle({ ...r, borderColor: rgb(cr, cg, cb), borderWidth: p.thickness, color: p.fill ? rgb(cr, cg, cb) : undefined, opacity: p.fill ? p.fillOpacity : undefined });
      return { doc };
    },
  },

  {
    id: 'annotate.line', label: 'Line', group: 'annotate', icon: 'line',
    description: 'Draw a straight line (optionally an arrow) between two points.',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x1: { type: 'number', required: true }, y1: { type: 'number', required: true },
      x2: { type: 'number', required: true }, y2: { type: 'number', required: true },
      color: { type: 'string', default: '#ff3b30' }, thickness: { type: 'number', default: 2, min: 0.25, max: 40 },
      arrow: { type: 'bool', default: false },
    },
    run(doc, p) {
      const { rgb } = lib();
      const page = pageOf(doc, p.page);
      const [cr, cg, cb] = hexToRgb(p.color, [1, 0.23, 0.19]);
      const color = rgb(cr, cg, cb);
      const a = ptToPdf(page, p.x1, p.y1), b = ptToPdf(page, p.x2, p.y2);
      page.drawLine({ start: a, end: b, thickness: p.thickness, color });
      if (p.arrow) {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = 8 + p.thickness * 2;
        for (const off of [Math.PI - 0.5, Math.PI + 0.5]) {
          page.drawLine({ start: b, end: { x: b.x + len * Math.cos(ang + off), y: b.y + len * Math.sin(ang + off) }, thickness: p.thickness, color });
        }
      }
      return { doc };
    },
  },

  {
    id: 'annotate.pencil', label: 'Freehand', group: 'annotate', icon: 'pencil',
    description: 'Draw a freehand path through a list of normalized points.',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      points: { type: 'array', required: true, minItems: 2, items: { type: 'object', of: { x: { type: 'number', required: true }, y: { type: 'number', required: true } } } },
      color: { type: 'string', default: '#ff3b30' }, thickness: { type: 'number', default: 2.5, min: 0.25, max: 40 },
    },
    run(doc, p) {
      const { rgb } = lib();
      const page = pageOf(doc, p.page);
      const [cr, cg, cb] = hexToRgb(p.color, [1, 0.23, 0.19]);
      const color = rgb(cr, cg, cb);
      const pts = p.points.map(pt => ptToPdf(page, pt.x, pt.y));
      for (let i = 1; i < pts.length; i++) page.drawLine({ start: pts[i - 1], end: pts[i], thickness: p.thickness, color });
      return { doc };
    },
  },

  {
    id: 'annotate.textbox', label: 'Text box', group: 'annotate', icon: 'textbox',
    description: 'Place typed text at a point (normalized coords; top-left of the text).',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      text: { type: 'string', required: true, maxLength: 2000 },
      fontSize: { type: 'number', default: 14, min: 4, max: 200 },
      color: { type: 'string', default: '#111111' },
    },
    async run(doc, p) {
      const { rgb, StandardFonts } = lib();
      const font = await doc.pdf.embedFont(StandardFonts.Helvetica);
      const page = pageOf(doc, p.page);
      const [cr, cg, cb] = hexToRgb(p.color, [0.07, 0.07, 0.07]);
      const at = ptToPdf(page, p.x, p.y);
      const lines = String(p.text).split('\n');
      lines.forEach((line, i) => {
        page.drawText(line, { x: at.x, y: at.y - p.fontSize * (i + 1), size: p.fontSize, font, color: rgb(cr, cg, cb) });
      });
      return { doc };
    },
  },
];
