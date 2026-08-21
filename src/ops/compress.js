// ops/compress.js — reduce file size by rasterizing each page to JPEG and rebuilding.
// This is the honest, pragmatic v1.0 compressor: it genuinely shrinks image-heavy and
// scanned PDFs, but it FLATTENS the page to an image — selectable text is lost (run OCR
// after if you need it back). Targeted image-XObject downsampling that preserves the
// text layer is the v1.1 path (the roadmap's qpdf-wasm). Browser-only (render + canvas).

import { getEngine } from '../core/engines.js';
import { openForRender } from '../core/render.js';
import { SheafDoc } from '../core/doc.js';
// one canonical metadata-carry (keywords/creator/producer included)
import { carryMetadata } from './pages.js';
import { dataUrlToBytes } from './_util.js';

function lib() { return getEngine('pdf-lib'); }
function nameOf(v) { const s = v && typeof v.asString === 'function' ? v.asString() : ''; return s.replace(/^\//, ''); }

// True only for a baseline-JPEG (DCTDecode) DeviceRGB/DeviceGray image with no soft mask whose
// larger pixel side exceeds maxDim. Everything else — CMYK, Indexed, ICCBased, JPX/CCITT/1-bit,
// multi-filter, SMask-bearing, already-small — is deliberately OUT of this increment's scope and
// left byte-for-byte. Pure (no canvas) so the decision is unit-testable. `L` = the pdf-lib engine.
export function isCompressibleImage(xobj, maxDim, L) {
  const { PDFRawStream, PDFName } = L;
  if (!(xobj instanceof PDFRawStream)) return false;
  const d = xobj.dict;
  if (nameOf(d.get(PDFName.of('Subtype'))) !== 'Image') return false;
  if (d.get(PDFName.of('SMask')) || d.get(PDFName.of('Mask'))) return false;      // don't drop transparency
  if (d.get(PDFName.of('ImageMask'))) return false;                               // stencil mask, not a photo
  if (d.get(PDFName.of('Decode'))) return false;                                  // a /Decode array (e.g. inversion) can't survive a canvas re-encode → leave it
  const filter = d.get(PDFName.of('Filter'));
  if (nameOf(filter) !== 'DCTDecode') return false;                               // single DCTDecode only (skip arrays/other)
  const cs = nameOf(d.get(PDFName.of('ColorSpace')));
  if (cs !== 'DeviceRGB' && cs !== 'DeviceGray') return false;                    // canvas re-encode is RGB; skip CMYK/Indexed/ICC
  const w = numOf(d.get(PDFName.of('Width'))), h = numOf(d.get(PDFName.of('Height')));
  if (!(w > 0 && h > 0)) return false;
  return Math.max(w, h) > maxDim;
}
function numOf(v) { return v && typeof v.asNumber === 'function' ? v.asNumber() : Number(v); }

// Build a fresh DCTDecode image XObject stream (RGB, 8bpc) from re-encoded JPEG bytes, preserving
// nothing but the image essentials — canvas JPEG output is always baseline RGB. Pure.
export function buildJpegXObject(ctx, jpegBytes, w, h, L) {
  const { PDFRawStream, PDFName, PDFNumber } = L;
  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  dict.set(PDFName.of('Width'), PDFNumber.of(w));
  dict.set(PDFName.of('Height'), PDFNumber.of(h));
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.set(PDFName.of('Length'), PDFNumber.of(jpegBytes.length));
  return PDFRawStream.of(dict, jpegBytes);
}

// Every image-XObject ref on a page's Resources /XObject (depth 1 — the common placement; images
// nested inside form XObjects are out of this increment's scope). The op dedupes across pages so a
// shared image is downsampled once. Pure.
export function pageImageRefs(ctx, page, L) {
  const { PDFName, PDFDict, PDFRef } = L;
  const resources = ctx.lookup(page.node.get(PDFName.of('Resources')));
  const xobjDict = resources instanceof PDFDict ? ctx.lookup(resources.get(PDFName.of('XObject'))) : null;
  const refs = [];
  if (xobjDict instanceof PDFDict) {
    for (const key of xobjDict.keys()) { const r = xobjDict.get(key); if (r instanceof PDFRef) refs.push(r); }
  }
  return refs;
}

// Re-encode one JPEG's bytes at a smaller size via the browser canvas. Browser-only.
async function downscaleJpeg(jpegBytes, maxDim, quality) {
  const bitmap = await createImageBitmap(new Blob([jpegBytes], { type: 'image/jpeg' }));
  const scale = maxDim / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
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
      carryMetadata(doc.pdf, out);
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
  {
    id: 'compress.images', label: 'Compress images (keep text)', group: 'compress', icon: 'compress',
    description: 'Downsample oversized JPEG images in place, leaving the text layer and vectors intact. Only baseline-JPEG (DCTDecode) RGB/grayscale images larger than maxDim are touched; other image types are left unchanged. Text stays selectable — unlike the lossy full-page rasterizer.',
    agentCallable: false, // browser-only (canvas)
    params: {
      maxDim: { type: 'int', default: 2000, min: 200, max: 8000 },
      quality: { type: 'number', default: 0.6, min: 0.1, max: 0.95 },
    },
    async run(doc, { maxDim, quality }) {
      const L = lib();
      const ctx = doc.pdf.context;
      // Collect distinct in-scope image refs across all pages (a shared image is done once).
      const seen = new Set();
      const targets = [];
      for (const page of doc.pdf.getPages()) {
        for (const ref of pageImageRefs(ctx, page, L)) {
          const tag = `${ref.objectNumber} ${ref.generationNumber}`;
          if (seen.has(tag)) continue;
          seen.add(tag);
          const xobj = ctx.lookup(ref);
          if (isCompressibleImage(xobj, maxDim, L)) targets.push({ ref, xobj });
        }
      }
      for (const { ref, xobj } of targets) {
        try {
          const { bytes, w, h } = await downscaleJpeg(xobj.contents, maxDim, quality);
          // Only keep the re-encode if it actually got smaller — never inflate.
          if (bytes.length < xobj.contents.length) ctx.assign(ref, buildJpegXObject(ctx, bytes, w, h, L));
        } catch { /* a single un-decodable image must not fail the whole op — skip it */ }
      }
      if (!targets.length) return { doc, warning: 'No oversized JPEG images to compress (other image types were left unchanged).' };
      return { doc };
    },
  },
];
