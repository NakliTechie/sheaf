// ops/ocr.js — make scanned PDFs searchable. Renders each page to an image (PDF.js),
// recognizes it locally (Tesseract, vendored), and lays an INVISIBLE text layer over
// the image at the word positions. The page still looks identical; the text is now
// selectable, searchable, and extractable. Browser-only (needs a canvas + the OCR
// engine); not in the headless suite, but deterministic given the same input.

import { getEngine } from '../core/engines.js';
import { openForRender } from '../core/render.js';
import { recognizeCanvas } from '../core/ocr.js';
import { winAnsiSafe } from './textsafe.js';

const SCALE = 2; // render resolution for OCR (higher = better recognition, slower)

function resolveTargets(doc, pages) {
  const count = doc.pageCount();
  if (!pages || !pages.length) return [...Array(count).keys()];
  for (const i of pages) if (i < 0 || i >= count) throw new Error(`Page ${i} out of range`);
  return pages;
}

async function renderToCanvas(pdf, pageIndex, scale) {
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, isEvalSupported: false }).promise;
  return canvas;
}

// Lay invisible (opacity 0) text at each recognized word's position. The bbox is in
// rendered-image pixels at SCALE; convert to PDF points (y flipped).
function layInvisibleText(pdfPage, font, words, scale) {
  const { rgb } = getEngine('pdf-lib');
  const { height: Hpt } = pdfPage.getSize();
  let placed = 0;
  for (const w of words || []) {
    const txt = w.text?.trim();
    if (!txt || (w.confidence ?? 0) < 30) continue;
    const { x0, y0, x1, y1 } = w.bbox || {};
    if (x1 == null) continue;
    const sizePt = Math.max(4, (y1 - y0) / scale);
    pdfPage.drawText(winAnsiSafe(txt), { x: x0 / scale, y: Hpt - (y1 / scale), size: sizePt, font, color: rgb(0, 0, 0), opacity: 0 });
    placed++;
  }
  return placed;
}

export const ops = [
  {
    id: 'ocr.searchable', label: 'OCR — make searchable', group: 'ocr', icon: 'ocr',
    description: 'Recognize text on scanned pages and add an invisible, selectable text layer (100% local). The page looks unchanged but becomes searchable.',
    agentCallable: false, // heavy + browser-only (canvas + OCR engine)
    params: { pages: { type: 'array', items: { type: 'int', min: 0 } } },
    async run(doc, { pages }) {
      const { StandardFonts } = getEngine('pdf-lib');
      const font = await doc.pdf.embedFont(StandardFonts.Helvetica);
      const pdf = await openForRender(await doc.toBytes());
      try {
        for (const i of resolveTargets(doc, pages)) {
          const canvas = await renderToCanvas(pdf, i, SCALE);
          const data = await recognizeCanvas(canvas);
          layInvisibleText(doc.pdf.getPages()[i], font, data.words, SCALE);
        }
      } finally { pdf.destroy?.(); }
      return { doc };
    },
  },

  {
    id: 'ocr.extract', label: 'OCR — extract text', group: 'ocr', icon: 'ocr',
    description: 'Recognize and return the text of scanned pages as an artifact (does not change the document). 100% local.',
    agentCallable: false, mutates: false,
    params: { pages: { type: 'array', items: { type: 'int', min: 0 } } },
    async run(doc, { pages }) {
      const pdf = await openForRender(await doc.toBytes());
      const out = [];
      try {
        for (const i of resolveTargets(doc, pages)) {
          const canvas = await renderToCanvas(pdf, i, SCALE);
          const data = await recognizeCanvas(canvas);
          out.push(data.text || '');
        }
      } finally { pdf.destroy?.(); }
      return { artifact: { text: out.join('\n\n'), pages: out } };
    },
  },
];
