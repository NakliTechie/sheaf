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
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

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

export function carryMetadata(src, out) {
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
      angle: { type: 'int', required: true },
    },
    run(doc, { pages, angle }) {
      if (angle % 90 !== 0) throw new Error('Rotation angle must be a multiple of 90');
      assertPages(pages, doc.pageCount());
      const { degrees } = lib();
      const ps = doc.pdf.getPages();
      // Dedupe: rotate is a per-page delta, so a repeated index would compound (0,0 → 180°).
      for (const i of new Set(pages)) {
        const cur = ps[i].getRotation().angle;
        ps[i].setRotation(degrees(norm360(cur + angle)));
      }
      return { doc };
    },
  },

  {
    id: 'pages.crop', label: 'Crop pages', group: 'page', icon: 'crop',
    description: 'Crop the given pages to a rectangle, given as a normalized region (top-left origin, 0..1). Sets each page CropBox — visible-area only; no content is removed, so the crop is reversible by cropping to the full page.',
    agentCallable: true,
    params: {
      pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 },
      x: { type: 'number', required: true, min: 0, max: 1 },
      y: { type: 'number', required: true, min: 0, max: 1 },
      w: { type: 'number', required: true, min: 0, max: 1 },
      h: { type: 'number', required: true, min: 0, max: 1 },
    },
    run(doc, { pages, x, y, w, h }) {
      assertPages(pages, doc.pageCount());
      const x0 = clamp01(x), y0 = clamp01(y);
      const ww = clamp01(Math.min(w, 1 - x0)), hh = clamp01(Math.min(h, 1 - y0));
      if (ww <= 0 || hh <= 0) throw new Error('Crop rectangle must have positive width and height');
      const ps = doc.pdf.getPages();
      for (const i of pages) {
        const { width: W, height: H } = ps[i].getSize();
        // Normalized top-left rect → PDF CropBox (bottom-left origin, page user space).
        ps[i].setCropBox(x0 * W, H * (1 - (y0 + hh)), ww * W, hh * H);
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
    id: 'pages.orient', label: 'Set orientation', group: 'page', icon: 'rotate',
    description: 'Set the rotation of the given pages to an absolute angle (0, 90, 180, or 270), replacing their current rotation rather than adding to it.',
    agentCallable: true,
    params: {
      pages: { type: 'array', required: true, items: { type: 'int', min: 0 }, minItems: 1 },
      angle: { type: 'int', required: true, enum: [0, 90, 180, 270] },
    },
    run(doc, { pages, angle }) {
      assertPages(pages, doc.pageCount());
      const { degrees } = lib();
      const ps = doc.pdf.getPages();
      for (const i of new Set(pages)) ps[i].setRotation(degrees(angle));
      return { doc };
    },
  },

  {
    id: 'pages.keepRange', label: 'Keep page range', group: 'page', icon: 'extract',
    description: 'Keep only pages [from..to] inclusive (0-based) and drop the rest, into a fresh document (metadata carried).',
    agentCallable: true,
    params: {
      from: { type: 'int', required: true, min: 0 },
      to: { type: 'int', required: true, min: 0 },
    },
    async run(doc, { from, to }) {
      const count = doc.pageCount();
      if (from > to) throw new Error(`from (${from}) must be <= to (${to})`);
      if (from < 0 || to >= count) throw new Error(`range ${from}..${to} out of bounds (document has ${count} page${count === 1 ? '' : 's'})`);
      const order = [];
      for (let i = from; i <= to; i++) order.push(i);
      return { doc: await rebuildFromOrder(doc, order) };
    },
  },

  {
    id: 'pages.addMargin', label: 'Add margins', group: 'page', icon: 'scale',
    description: 'Add a uniform margin (whitespace) around the visible area of the given pages by growing the page box; existing content is preserved in place. Decision: bigger page, content kept — not shrunk. Margin is added around the current CropBox, so it composes with an earlier crop.',
    agentCallable: true,
    params: {
      margin: { type: 'number', required: true, min: 0, max: 400 },
      pages: { type: 'array', items: { type: 'int', min: 0 } },
    },
    run(doc, { margin, pages }) {
      const ps = doc.pdf.getPages();
      const targets = (pages && pages.length) ? pages : [...Array(ps.length).keys()];
      for (const i of new Set(targets)) {
        if (i < 0 || i >= ps.length) throw new Error(`Page ${i} out of range`);
        const b = ps[i].getCropBox();
        const nx = b.x - margin, ny = b.y - margin, nw = b.width + 2 * margin, nh = b.height + 2 * margin;
        ps[i].setMediaBox(nx, ny, nw, nh);
        ps[i].setCropBox(nx, ny, nw, nh);
      }
      return { doc };
    },
  },

  {
    id: 'pages.nUp', label: 'N-up (pages per sheet)', group: 'page', icon: 'scale',
    description: 'Place 2 or 4 source pages onto each output sheet, scaled to fit their cell, into a fresh document. Sheet size = the first source page; a small gutter is left around each.',
    agentCallable: true,
    params: { perSheet: { type: 'int', default: 2, enum: [2, 4] } },
    async run(doc, { perSheet }) {
      const { PDFDocument } = lib();
      const out = await PDFDocument.create();
      carryMetadata(doc.pdf, out);
      const srcCount = doc.pageCount();
      const cols = perSheet === 4 ? 2 : 1;
      const rows = perSheet / cols;
      const first = doc.pdf.getPage(0).getSize();
      const cellW = first.width / cols, cellH = first.height / rows;
      for (let start = 0; start < srcCount; start += perSheet) {
        const sheet = out.addPage([first.width, first.height]);
        for (let j = 0; j < perSheet && start + j < srcCount; j++) {
          const srcPage = doc.pdf.getPage(start + j);
          const { width: sw, height: sh } = srcPage.getSize();
          // A genuinely blank page (e.g. an inserted blank) has no Contents; pdf-lib can't
          // embed it (the error is deferred to save), so skip it → empty cell, no crash.
          if (!srcPage.node.Contents()) continue;
          const emb = await out.embedPage(srcPage);
          const scale = Math.min(cellW / sw, cellH / sh) * 0.95; // small gutter
          const col = j % cols, row = Math.floor(j / cols);
          const x = col * cellW + (cellW - sw * scale) / 2;
          const yTop = row * cellH + (cellH - sh * scale) / 2; // grid runs top→down
          const y = first.height - yTop - sh * scale;          // PDF origin is bottom-left
          sheet.drawPage(emb, { x, y, xScale: scale, yScale: scale });
        }
      }
      return { doc: new SheafDoc(out, null) };
    },
  },

  {
    id: 'pages.reverse', label: 'Reverse page order', group: 'page', icon: 'reorder',
    description: 'Reverse the order of all pages in the document.',
    agentCallable: true,
    params: {},
    async run(doc) {
      const count = doc.pageCount();
      const order = [...Array(count).keys()].reverse();
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
      // Dedupe: scale multiplies, so a repeated index would compound (2,2 → 4×).
      for (const i of new Set(pages)) ps[i].scale(factor, factor);
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
