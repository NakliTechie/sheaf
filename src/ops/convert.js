// ops/convert.js — conversion outputs (artifacts, not document mutations). Text
// extraction uses the PDF.js side of the adapter, so these run in the browser; they
// don't change the document, they produce something to download. PDF→image export and
// images→PDF are tracked follow-ups (PDF→PNG is browser-render-to-canvas; images→PDF
// is an open-side flow) — flagged here so the convert group's scope is explicit.

import { openForRender, pageText } from '../core/render.js';

export const ops = [
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
