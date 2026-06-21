// render.js — the render/text-layer side of the nakli-doc adapter (PDF.js, browser).
// Pixels are *derived* from the document model's bytes; doc.js (pdf-lib) stays the
// source of truth. After a mutating op the viewer re-derives a render doc from the
// new bytes. This split keeps the structure side (and the M0 gate) browser-free.

import { loadEngine, pdfjsWorkerUrl, isLoaded, getEngine } from './engines.js';

let _ready = null;

export async function ensurePdfjs() {
  if (_ready) return _ready;
  _ready = (async () => {
    const pdfjs = isLoaded('pdfjs') ? getEngine('pdfjs') : await loadEngine('pdfjs');
    // Worker pinned + same-origin (worker-src 'self').
    pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl();
    return pdfjs;
  })();
  return _ready;
}

// Parse bytes into a PDF.js document proxy for rendering. PDF.js may detach the
// buffer it's given, so we hand it a copy — never our canonical bytes.
export async function openForRender(bytes) {
  const pdfjs = await ensurePdfjs();
  const data = bytes.slice(0);
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  return task.promise; // PDFDocumentProxy — caller must .destroy() when replacing
}

// How long to wait for a single page's render promise before moving on. The canvas
// paints incrementally as the operator list executes, so on timeout the page is
// usually already visible — we just stop blocking the viewport on a render that is
// pathologically slow (a huge/complex page) or whose promise never settles. Degrade
// clean, never freeze (handoff §8).
const RENDER_TIMEOUT_MS = 12000;

// Render one page (0-based) into a canvas at the given scale. Resolves with the CSS
// px size, or { timedOut:true } if the render did not settle in time (the canvas may
// still have painted). Never rejects on timeout — the caller keeps going.
export async function renderPage(pdf, pageIndex, scale, canvas) {
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext('2d');
  const task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res({ timedOut: true }), RENDER_TIMEOUT_MS); });
  try {
    const r = await Promise.race([task.promise.then(() => ({ ok: true })), timeout]);
    if (r.timedOut) { try { task.cancel(); } catch {} return { width: viewport.width, height: viewport.height, timedOut: true }; }
    return { width: viewport.width, height: viewport.height };
  } finally { clearTimeout(timer); }
}

// Extract the concatenated text of a page (search, and the M3 text layer).
export async function pageText(pdf, pageIndex) {
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  return tc.items.map(i => i.str).join(' ');
}

// Does the document have any extractable text? (welcome/empty heuristics, OCR hint.)
export async function hasTextLayer(pdf) {
  const n = Math.min(pdf.numPages, 3);
  for (let i = 0; i < n; i++) { if ((await pageText(pdf, i)).trim().length > 0) return true; }
  return false;
}
