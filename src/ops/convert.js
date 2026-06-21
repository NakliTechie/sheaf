// ops/convert.js — conversion outputs (artifacts, not document mutations). Text
// extraction uses the PDF.js side of the adapter, so these run in the browser; they
// don't change the document, they produce something to download. PDF→image export and
// images→PDF are tracked follow-ups (PDF→PNG is browser-render-to-canvas; images→PDF
// is an open-side flow) — flagged here so the convert group's scope is explicit.

import { openForRender, pageText } from '../core/render.js';

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export const ops = [
  {
    id: 'convert.pageImage', label: 'Page → image', group: 'convert', icon: 'image',
    description: 'Render a page to a PNG or JPEG image (artifact). scale is the render resolution multiplier.',
    agentCallable: false, mutates: false, // browser-only (canvas)
    params: {
      page: { type: 'int', required: true, min: 0 },
      format: { type: 'string', default: 'png', enum: ['png', 'jpeg'] },
      scale: { type: 'number', default: 2, min: 0.5, max: 5 },
    },
    async run(doc, { page, format, scale }) {
      if (page < 0 || page >= doc.pageCount()) throw new Error(`Page ${page} out of range`);
      const pdf = await openForRender(await doc.toBytes());
      try {
        const p = await pdf.getPage(page + 1);
        const vp = p.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp, isEvalSupported: false }).promise;
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const bytes = dataUrlToBytes(canvas.toDataURL(mime, format === 'jpeg' ? 0.92 : undefined));
        return { artifact: { bytes, format, width: canvas.width, height: canvas.height } };
      } finally { pdf.destroy?.(); }
    },
  },
  {
    id: 'convert.text', label: 'Extract text', group: 'convert', icon: 'textbox',
    description: 'Extract the document’s text, page by page, as a downloadable .txt artifact. Does not change the document.',
    agentCallable: true, mutates: false,
    params: {},
    async run(doc) {
      const bytes = await doc.toBytes();
      const pdf = await openForRender(bytes);
      const pages = [];
      for (let i = 0; i < pdf.numPages; i++) pages.push(await pageText(pdf, i));
      pdf.destroy?.();
      return { artifact: { text: pages.join('\n\n'), pageCount: pages.length, pages } };
    },
  },
];
