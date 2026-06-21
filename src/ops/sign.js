// ops/sign.js — appearance signing. Places a typed signature (and optional date line)
// onto the page. The date is a PARAMETER, not the clock, so the op stays deterministic
// and replayable — the UI passes today's date. Drawn/image signatures and a saved
// signature library ride the storage façade and land as a v1.x enrichment; the
// deterministic appearance-sign is the v1.0 floor.
//
// Cryptographic (PAdES) signing is a separate, later tier (handoff v1.2, WebCrypto) —
// this is the visible-appearance signature, explicitly not a cryptographic guarantee.

import { getEngine } from '../core/engines.js';
import { winAnsiSafe } from './textsafe.js';

export const ops = [
  {
    id: 'sign.place', label: 'Sign', group: 'sign', icon: 'pencil',
    description: 'Place a typed signature (and optional date line) at a point (normalized 0..1 coords).',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      name: { type: 'string', required: true, maxLength: 200 },
      dateText: { type: 'string', default: '' },
      fontSize: { type: 'number', default: 20, min: 6, max: 120 },
      color: { type: 'string', default: '#1a3a8f' },
    },
    async run(doc, p) {
      const { rgb, StandardFonts } = getEngine('pdf-lib');
      const count = doc.pageCount();
      if (p.page < 0 || p.page >= count) throw new Error(`Page ${p.page} out of range`);
      const page = doc.pdf.getPages()[p.page];
      const { width: W, height: H } = page.getSize();
      const font = await doc.pdf.embedFont(StandardFonts.HelveticaOblique);
      const small = await doc.pdf.embedFont(StandardFonts.Helvetica);
      const m = /^#?([0-9a-f]{6})$/i.exec(p.color);
      const [r, g, b] = m ? [(parseInt(m[1], 16) >> 16 & 255) / 255, (parseInt(m[1], 16) >> 8 & 255) / 255, (parseInt(m[1], 16) & 255) / 255] : [0.1, 0.23, 0.56];
      const x = p.x * W, yTop = H * (1 - p.y);
      page.drawText(winAnsiSafe(p.name), { x, y: yTop - p.fontSize, size: p.fontSize, font, color: rgb(r, g, b) });
      // Underline + optional date.
      page.drawLine({ start: { x, y: yTop - p.fontSize - 4 }, end: { x: x + font.widthOfTextAtSize(winAnsiSafe(p.name), p.fontSize), y: yTop - p.fontSize - 4 }, thickness: 0.75, color: rgb(r, g, b) });
      if (p.dateText) page.drawText(winAnsiSafe(p.dateText), { x, y: yTop - p.fontSize - 18, size: Math.max(8, p.fontSize * 0.5), font: small, color: rgb(0.3, 0.3, 0.3) });
      return { doc };
    },
  },

  {
    id: 'sign.image', label: 'Place signature image', group: 'sign', icon: 'sign',
    description: 'Place a PNG/JPEG signature (drawn, uploaded, or from the library) at a point. width is a 0..1 fraction of the page; height follows the image aspect.',
    agentCallable: false, // image bytes, browser-side
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      width: { type: 'number', default: 0.28, min: 0.02, max: 1 },
      imageBytes: { type: 'bytes', required: true },
    },
    async run(doc, p) {
      const count = doc.pageCount();
      if (p.page < 0 || p.page >= count) throw new Error(`Page ${p.page} out of range`);
      const u8 = p.imageBytes instanceof Uint8Array ? p.imageBytes : new Uint8Array(p.imageBytes);
      const isPng = u8[0] === 0x89 && u8[1] === 0x50;
      const img = isPng ? await doc.pdf.embedPng(u8) : await doc.pdf.embedJpg(u8);
      const page = doc.pdf.getPages()[p.page];
      const { width: W, height: H } = page.getSize();
      const pw = p.width * W;
      const ph = pw * (img.height / img.width);
      // (x,y) is the top-left of the placement, normalized; pdf-lib draws from bottom-left.
      page.drawImage(img, { x: p.x * W, y: H * (1 - p.y) - ph, width: pw, height: ph });
      return { doc };
    },
  },
];
