// doc.js — the nakli-doc PDF adapter (write/structure side).
//
// nakli-doc is the suite's document-model abstraction. Here it is implemented over
// pdf-lib: a PDF is a *document object* — pages, sizes, rotations, the metadata
// dict — not a pixel surface (that's Slate). The canonical state is the byte buffer;
// a live pdf-lib PDFDocument is the working representation ops mutate.
//
// Rendering and the text layer (PDF.js) are a separate, browser-only adapter
// (render.js) that derives pixels from this model. Keeping the structure side free
// of PDF.js is what lets the M0 replay gate run headlessly.

import { getEngine } from './engines.js';
import { validatePdfBytes } from './schema.js';

export class SheafDoc {
  constructor(pdf, sourceBytes) {
    this._pdf = pdf;             // pdf-lib PDFDocument (the write model)
    this._sourceBytes = sourceBytes; // bytes this doc was parsed from (immutable origin)
  }

  // pdf-lib module, for ops that need PDFDocument / rgb / degrees etc.
  static get lib() { return getEngine('pdf-lib'); }

  static async fromBytes(bytes, { validate = true } = {}) {
    const { PDFDocument } = getEngine('pdf-lib');
    const clean = validate
      ? validatePdfBytes(bytes)
      : (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    // updateMetadata:false — never silently stamp the user's file with our producer.
    const pdf = await PDFDocument.load(clean, { updateMetadata: false, ignoreEncryption: true });
    return new SheafDoc(pdf, clean);
  }

  static async blank(pageCount = 1, size = [612, 792]) {
    const { PDFDocument } = getEngine('pdf-lib');
    const pdf = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) pdf.addPage(size);
    return new SheafDoc(pdf, null);
  }

  get pdf() { return this._pdf; }
  setPdf(pdf) { this._pdf = pdf; }        // for ops that build a fresh doc (merge/extract)

  pageCount() { return this._pdf.getPageCount(); }

  pages() {
    return this._pdf.getPages().map((p, i) => {
      const { width, height } = p.getSize();
      return { index: i, width: round(width), height: round(height), rotation: norm360(p.getRotation().angle) };
    });
  }

  getMetadata() {
    const g = (fn) => { try { return this._pdf[fn]() ?? null; } catch { return null; } };
    const d = (fn) => { const v = g(fn); return v instanceof Date ? v.toISOString() : v; };
    return {
      title: g('getTitle'), author: g('getAuthor'), subject: g('getSubject'),
      keywords: g('getKeywords'), creator: g('getCreator'), producer: g('getProducer'),
      creationDate: d('getCreationDate'), modificationDate: d('getModificationDate'),
    };
  }

  // Serialize to bytes. useObjectStreams keeps output compact + deterministic.
  async toBytes() { return await this._pdf.save({ useObjectStreams: true }); }

  // A semantic fingerprint of document state: page geometry + metadata. This is the
  // equality the M0 replay gate checks ("state reconstructed"), robust to byte-level
  // re-serialization differences. Text-layer fingerprinting is browser-side (render.js).
  fingerprint() {
    return {
      pageCount: this.pageCount(),
      pages: this.pages().map(p => ({ w: p.width, h: p.height, r: p.rotation })),
      meta: this.getMetadata(),
    };
  }

  async fingerprintHash() {
    const json = JSON.stringify(this.fingerprint());
    const buf = new TextEncoder().encode(json);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

function round(n) { return Math.round(n * 100) / 100; }
function norm360(a) { return ((a % 360) + 360) % 360; }
