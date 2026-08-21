// ops/text.js — text editing via whiteout-and-retype. Covers a region with an opaque
// rectangle (default white) and optionally draws replacement text. This is the
// pragmatic ~80% of in-place text editing.
//
// Font-matched span-replace: the caller (ui/spanedit.js) detects the run's family
// (serif/sans/mono), weight, and slant from the PDF.js text layer + loaded font object,
// and its baseline, then passes them here so the retype uses the closest Standard-14 face
// on the original baseline — not always Helvetica. Reusing the exact EMBEDDED glyph
// program (perfect fidelity for same-glyph edits) needs a vendored fontkit and is the
// remaining step; see plan/pending.md.
//
// Coordinates are normalized 0..1 (screen orientation), like annotations.

import { getEngine } from '../core/engines.js';
import { winAnsiSafe } from './textsafe.js';
import { hexToRgb } from './_util.js';

function lib() { return getEngine('pdf-lib'); }

// Map a detected family + weight + slant to the closest Standard-14 face. These are
// the fonts pdf-lib embeds without fontkit, so this works for any replacement text.
function pickStdFont(SF, family, bold, italic) {
  const fam = family === 'serif' ? 'times' : family === 'mono' ? 'courier' : 'helv';
  if (fam === 'times') return bold && italic ? SF.TimesRomanBoldItalic : bold ? SF.TimesRomanBold : italic ? SF.TimesRomanItalic : SF.TimesRoman;
  if (fam === 'courier') return bold && italic ? SF.CourierBoldOblique : bold ? SF.CourierBold : italic ? SF.CourierOblique : SF.Courier;
  return bold && italic ? SF.HelveticaBoldOblique : bold ? SF.HelveticaBold : italic ? SF.HelveticaOblique : SF.Helvetica;
}

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
      // Font match: family is 'sans' | 'serif' | 'mono' (default sans → Helvetica).
      fontFamily: { type: 'string', default: 'sans' },
      bold: { type: 'bool', default: false },
      italic: { type: 'bool', default: false },
      // Normalized (0..1, top-origin) baseline of the original run; when given, the
      // retype sits on it instead of being vertically centered in the covered box.
      baseline: { type: 'number', default: null },
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
        const font = await doc.pdf.embedFont(pickStdFont(StandardFonts, p.fontFamily, p.bold, p.italic));
        const [tr, tg, tb] = hexToRgb(p.textColor, [0.07, 0.07, 0.07]);
        // Sit on the original baseline when the caller matched it; else center in the box.
        const ty = (typeof p.baseline === 'number')
          ? H * (1 - p.baseline)
          : ry + Math.max(2, (rh - p.fontSize) / 2);
        page.drawText(winAnsiSafe(p.text), { x: rx + 2, y: ty, size: p.fontSize, font, color: rgb(tr, tg, tb) });
      }
      return { doc };
    },
  },
];
