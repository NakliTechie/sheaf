// ops/text.js — text editing via whiteout-and-retype. Covers a region with an opaque
// rectangle (default white) and optionally draws replacement text. This is the
// pragmatic ~80% of in-place text editing; font-matched span-replace (which needs the
// PDF.js text layer for glyph positions + font detection) is a v1.x refinement.
//
// Coordinates are normalized 0..1 (screen orientation), like annotations.

import { getEngine } from '../core/engines.js';
import { winAnsiSafe } from './textsafe.js';

function lib() { return getEngine('pdf-lib'); }
function hexToRgb(hex, fb) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return fb; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

export const ops = [
  {
    id: 'text.whiteout', label: 'Whiteout & retype', group: 'text', icon: 'textbox',
    description: 'Cover a region with an opaque rectangle (default white) and optionally draw replacement text over it.',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      w: { type: 'number', required: true }, h: { type: 'number', required: true },
      fillColor: { type: 'string', default: '#ffffff' },
      text: { type: 'string', default: '', maxLength: 2000 },
      fontSize: { type: 'number', default: 12, min: 4, max: 200 },
      textColor: { type: 'string', default: '#111111' },
    },
    async run(doc, p) {
      const { rgb, StandardFonts } = lib();
      const count = doc.pageCount();
      if (p.page < 0 || p.page >= count) throw new Error(`Page ${p.page} out of range`);
      const page = doc.pdf.getPages()[p.page];
      const { width: W, height: H } = page.getSize();
      const [fr, fg, fb] = hexToRgb(p.fillColor, [1, 1, 1]);
      const rx = p.x * W, ry = H * (1 - (p.y + p.h)), rw = p.w * W, rh = p.h * H;
      page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, color: rgb(fr, fg, fb) });
      if (p.text) {
        const font = await doc.pdf.embedFont(StandardFonts.Helvetica);
        const [tr, tg, tb] = hexToRgb(p.textColor, [0.07, 0.07, 0.07]);
        // Baseline a bit above the bottom of the covered box.
        page.drawText(winAnsiSafe(p.text), { x: rx + 2, y: ry + Math.max(2, (rh - p.fontSize) / 2), size: p.fontSize, font, color: rgb(tr, tg, tb) });
      }
      return { doc };
    },
  },
];
