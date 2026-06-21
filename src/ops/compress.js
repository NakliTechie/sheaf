// ops/compress.js — reduce file size by rasterizing each page to JPEG and rebuilding.
// This is the honest, pragmatic v1.0 compressor: it genuinely shrinks image-heavy and
// scanned PDFs, but it FLATTENS the page to an image — selectable text is lost (run OCR
// after if you need it back). Targeted image-XObject downsampling that preserves the
// text layer is the v1.1 path (the roadmap's qpdf-wasm). Browser-only (render + canvas).

import { getEngine } from '../core/engines.js';
import { openForRender } from '../core/render.js';
import { SheafDoc } from '../core/doc.js';

function carry(src, out) {
  const m = (g, s) => { try { const v = src[g](); if (v != null) out[s](v); } catch {} };
  m('getTitle', 'setTitle'); m('getAuthor', 'setAuthor'); m('getSubject', 'setSubject');
  m('getCreationDate', 'setCreationDate'); m('getModificationDate', 'setModificationDate');
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export const ops = [
  {
    id: 'compress.rasterize', label: 'Compress (flatten to images)', group: 'compress', icon: 'compress',
    description: 'Rasterize each page to JPEG and rebuild — genuinely shrinks scanned/image-heavy PDFs. LOSSY: selectable text is flattened away (run OCR after to restore searchability).',
    agentCallable: false, // heavy + browser-only
    params: {
      quality: { type: 'number', default: 0.6, min: 0.1, max: 0.95 },
      scale: { type: 'number', default: 1.5, min: 0.5, max: 4 },
    },
    async run(doc, { quality, scale }) {
      const { PDFDocument } = getEngine('pdf-lib');
      const srcPages = doc.pdf.getPages().map(p => p.getSize());
      const pdf = await openForRender(await doc.toBytes());
      const out = await PDFDocument.create();
      carry(doc.pdf, out);
      try {
        for (let i = 0; i < pdf.numPages; i++) {
          const page = await pdf.getPage(i + 1);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, isEvalSupported: false }).promise;
          const jpg = await out.embedJpg(dataUrlToBytes(canvas.toDataURL('image/jpeg', quality)));
          const { width: W, height: H } = srcPages[i] || { width: vp.width, height: vp.height };
          out.addPage([W, H]).drawImage(jpg, { x: 0, y: 0, width: W, height: H });
        }
      } finally { pdf.destroy?.(); }
      return { doc: new SheafDoc(out, null) };
    },
  },
];
