// ops/convert.js — conversion outputs (artifacts, not document mutations). Text
// extraction uses the PDF.js side of the adapter, so these run in the browser; they
// don't change the document, they produce something to download. PDF→image export and
// images→PDF are tracked follow-ups (PDF→PNG is browser-render-to-canvas; images→PDF
// is an open-side flow) — flagged here so the convert group's scope is explicit.

import { openForRender, pageText } from '../core/render.js';
import { getEngine } from '../core/engines.js';
import { validatePdfBytes } from '../core/schema.js';
import { dataUrlToBytes } from './_util.js';

// Extract per-page text from raw PDF bytes (browser path — pdf.js).
async function extractPages(bytes) {
  const pdf = await openForRender(bytes);
  const pages = [];
  // finally so a throw mid-extraction doesn't leak the pdf.js document/worker (L1).
  try { for (let i = 0; i < pdf.numPages; i++) pages.push(await pageText(pdf, i)); }
  finally { pdf.destroy?.(); }
  return pages;
}

function nonBlankLines(t) { return String(t || '').split('\n').map(s => s.trim()).filter(Boolean); }

// Pure, headless-testable: two per-page text arrays → a Markdown diff summary. Set-based
// per-page line diff (a summary of added/removed lines, not a full LCS) — honest about
// what it is. Text-only; the visual-diff half is out of scope (attended).
export function comparePagesText(pagesA, pagesB) {
  const maxP = Math.max(pagesA.length, pagesB.length);
  const out = [];
  for (let i = 0; i < maxP; i++) {
    const a = nonBlankLines(pagesA[i]), b = nonBlankLines(pagesB[i]);
    const aSet = new Set(a), bSet = new Set(b);
    const removed = a.filter(l => !bSet.has(l));
    const added = b.filter(l => !aSet.has(l));
    const parts = [`## Page ${i + 1}`];
    if (!removed.length && !added.length) { parts.push('_No changes._'); }
    else {
      if (removed.length) parts.push('**Removed:**\n' + removed.map(l => `- ${l}`).join('\n'));
      if (added.length) parts.push('**Added:**\n' + added.map(l => `+ ${l}`).join('\n'));
    }
    out.push(parts.join('\n\n'));
  }
  return out.join('\n\n---\n\n');
}

// Pure, headless-testable: per-page extracted text → Markdown. Conservative — no heading
// synthesis (the text layer carries no reliable font-size signal), just normalized
// paragraphs with page breaks as horizontal rules.
export function pagesToMarkdown(pages) {
  return (pages || [])
    .map(t => String(t || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
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
      const pages = await extractPages(await doc.toBytes());
      return { artifact: { text: pages.join('\n\n'), pageCount: pages.length, pages } };
    },
  },

  {
    id: 'convert.markdown', label: 'Extract as Markdown', group: 'convert', icon: 'textbox',
    description: 'Extract the document text as Markdown — paragraphs preserved, page breaks as horizontal rules (---). Conservative (no heading guessing). Does not change the document.',
    agentCallable: true, mutates: false,
    params: {},
    async run(doc) {
      const pages = await extractPages(await doc.toBytes());
      return { artifact: { markdown: pagesToMarkdown(pages), pageCount: pages.length } };
    },
  },

  {
    id: 'convert.compareText', label: 'Compare text with another PDF', group: 'convert', icon: 'textbox',
    description: 'Compare this document’s text against another PDF, page by page, into a Markdown summary of added/removed lines. Text-only (no visual diff). Does not change the document.',
    agentCallable: true, mutates: false,
    params: { otherBytes: { type: 'bytes', required: true } },
    async run(doc, { otherBytes }) {
      validatePdfBytes(otherBytes);
      const a = await extractPages(await doc.toBytes());
      const b = await extractPages(otherBytes);
      return { artifact: { markdown: comparePagesText(a, b), pagesA: a.length, pagesB: b.length } };
    },
  },

  {
    id: 'convert.split', label: 'Split to files', group: 'convert', icon: 'extract',
    description: 'Split the document into one single-page PDF per page. Returns an artifact list of { name, bytes } for the UI to bundle into a zip. Does not change the document.',
    agentCallable: true, mutates: false,
    params: {},
    async run(doc) {
      const { PDFDocument } = getEngine('pdf-lib');
      const n = doc.pageCount();
      const files = [];
      for (let i = 0; i < n; i++) {
        const out = await PDFDocument.create();
        const [pg] = await out.copyPages(doc.pdf, [i]);
        out.addPage(pg);
        files.push({ name: `page-${String(i + 1).padStart(3, '0')}.pdf`, bytes: await out.save({ updateMetadata: false }) });
      }
      return { artifact: { files, count: n } };
    },
  },
];
