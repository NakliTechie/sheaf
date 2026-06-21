// ops/pages.js — page operations (pdf-lib). The Stirling "page ops" group,
// reimplemented browser-native. Property changes (rotate/scale) mutate pages in
// place; set/order changes (reorder/duplicate/extract/merge) build a fresh document
// via copyPages — the well-trodden pdf-lib path.
//
// Every op is deterministic: same input doc + same params → same output. That is
// what makes the op-log replayable (M0) and the agent face safe.

import { getEngine } from '../core/engines.js';
import { SheafDoc } from '../core/doc.js';
import { validatePdfBytes } from '../core/schema.js';

function lib() { return getEngine('pdf-lib'); }
function norm360(a) { return ((a % 360) + 360) % 360; }

function assertPages(indices, count) {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      throw new Error(`Page index ${i} out of range (document has ${count} page${count === 1 ? '' : 's'})`);
    }
  }
}

// Build a new SheafDoc by copying pages from src in the given index order.
// copyPages copies page content only — it does NOT carry the document's Info dict.
// We must copy metadata across, or reordering/extracting would silently wipe the
// user's title/author/dates AND stamp a fresh modification date (PDFDocument.create()
// sets it to "now"), which would also break replay determinism.
async function rebuildFromOrder(src, order) {
  const { PDFDocument } = lib();
  const out = await PDFDocument.create();
  carryMetadata(src.pdf, out);
  const copied = await out.copyPages(src.pdf, order);
  copied.forEach(p => out.addPage(p));
  return new SheafDoc(out, null);
}

function carryMetadata(src, out) {
  const move = (get, set, transform) => {
    try { const v = src[get](); if (v != null) out[set](transform ? transform(v) : v); } catch {}
  };
  move('getTitle', 'setTitle');
  move('getAuthor', 'setAuthor');
  move('getSubject', 'setSubject');
  move('getCreator', 'setCreator');
  move('getProducer', 'setProducer');
  move('getKeywords', 'setKeywords', (v) => Array.isArray(v) ? v : String(v).split(',').map(s => s.trim()).filter(Boolean));
  move('getCreationDate', 'setCreationDate');
  move('getModificationDate', 'setModificationDate');
}

export const ops = [
  {
    id: 'pages.rotate', label: 'Rotate pages', group: 'page', icon: 'rotate',
    description: 'Rotate the given pages by a multiple of 90° (relative to their current rotation).',
    agentCallable: true,
    params: {
      pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 },
      angle: { type: 'int', required: true, enum: undefined },
    },
    run(doc, { pages, angle }) {
      if (angle % 90 !== 0) throw new Error('Rotation angle must be a multiple of 90');
      assertPages(pages, doc.pageCount());
      const { degrees } = lib();
      const ps = doc.pdf.getPages();
      for (const i of pages) {
        const cur = ps[i].getRotation().angle;
        ps[i].setRotation(degrees(norm360(cur + angle)));
      }
      return { doc };
    },
  },

  {
    id: 'pages.delete', label: 'Delete pages', group: 'page', icon: 'trash',
    description: 'Remove the given pages from the document.',
    agentCallable: true,
    params: { pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 } },
    run(doc, { pages }) {
      const count = doc.pageCount();
      assertPages(pages, count);
      const unique = [...new Set(pages)];
      if (unique.length >= count) throw new Error('Cannot delete every page — a document needs at least one page');
      // Remove high index first so earlier indices stay valid.
      for (const i of unique.sort((a, b) => b - a)) doc.pdf.removePage(i);
      return { doc };
    },
  },

  {
    id: 'pages.reorder', label: 'Reorder pages', group: 'page', icon: 'reorder',
    description: 'Reorder pages to the given permutation of page indices.',
    agentCallable: true,
    params: { order: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 } },
    async run(doc, { order }) {
      const count = doc.pageCount();
      assertPages(order, count);
      if (order.length !== count || new Set(order).size !== count) {
        throw new Error(`order must be a permutation of all ${count} page indices`);
      }
      return { doc: await rebuildFromOrder(doc, order) };
    },
  },

  {
    id: 'pages.duplicate', label: 'Duplicate pages', group: 'page', icon: 'copy',
    description: 'Insert a copy of each given page directly after the original.',
    agentCallable: true,
    params: { pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 } },
    async run(doc, { pages }) {
      const count = doc.pageCount();
      assertPages(pages, count);
      const dup = new Set(pages);
      const order = [];
      for (let i = 0; i < count; i++) { order.push(i); if (dup.has(i)) order.push(i); }
      return { doc: await rebuildFromOrder(doc, order) };
    },
  },

  {
    id: 'pages.extract', label: 'Keep only pages', group: 'page', icon: 'extract',
    description: 'Reduce the document to only the given pages, in the given order.',
    agentCallable: true,
    params: { pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 } },
    async run(doc, { pages }) {
      assertPages(pages, doc.pageCount());
      return { doc: await rebuildFromOrder(doc, pages) };
    },
  },

  {
    id: 'pages.insertBlank', label: 'Insert blank page', group: 'page', icon: 'insert',
    description: 'Insert a blank page at the given index (0 = before the first page).',
    agentCallable: true,
    params: {
      at: { type: 'int', required: true, min: 0 },
      width: { type: 'number', default: 612, min: 1 },
      height: { type: 'number', default: 792, min: 1 },
    },
    run(doc, { at, width, height }) {
      const count = doc.pageCount();
      if (at > count) throw new Error(`Insert index ${at} out of range (0..${count})`);
      doc.pdf.insertPage(at, [width, height]);
      return { doc };
    },
  },

  {
    id: 'pages.scale', label: 'Scale pages', group: 'page', icon: 'scale',
    description: 'Scale the given pages (content and media box) by a factor.',
    agentCallable: true,
    params: {
      pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 },
      factor: { type: 'number', required: true, min: 0.05, max: 20 },
    },
    run(doc, { pages, factor }) {
      assertPages(pages, doc.pageCount());
      const ps = doc.pdf.getPages();
      for (const i of pages) ps[i].scale(factor, factor);
      return { doc };
    },
  },

  {
    id: 'pages.merge', label: 'Merge a PDF', group: 'page', icon: 'merge',
    description: 'Append (or prepend) all pages of another PDF, supplied as bytes.',
    agentCallable: true,
    params: {
      bytes: { type: 'bytes', required: true },
      position: { type: 'string', default: 'end', enum: ['end', 'start'] },
    },
    async run(doc, { bytes, position }) {
      const { PDFDocument } = lib();
      validatePdfBytes(bytes); // same %PDF ingress gate as open — agents can call this too
      const incoming = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const indices = incoming.getPageIndices();
      const copied = await doc.pdf.copyPages(incoming, indices);
      if (position === 'start') copied.reverse().forEach(p => doc.pdf.insertPage(0, p));
      else copied.forEach(p => doc.pdf.addPage(p));
      return { doc };
    },
  },
];
