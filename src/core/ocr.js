// ocr.js — the OCR engine adapter (Tesseract.js v7, browser). Everything is vendored
// same-origin under /engines/tesseract — the worker, the wasm core (embedded), and the
// English model — so OCR runs with NO network fetch and NO CDN: it works offline, and
// the "ask before any multi-MB download" rule is moot because nothing downloads. The
// page image never leaves the machine; recognition is entirely local.

import { enginesBase } from './engines.js';
import { emit } from './events.js';

const VER = '7.0.0';
// Integrity pin for the entry module (fetch → verify → import). The worker/core/lang
// are loaded by Tesseract from the same-origin vendored paths (version-pinned).
const ESM_SHA = '64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29';

let _mod = null;       // tesseract.esm module
let _worker = null;    // a live Tesseract worker (reused across pages)

function dir() { return `${enginesBase()}/tesseract/${VER}`; }

async function loadModule() {
  if (_mod) return _mod;
  const url = `${dir()}/tesseract.esm.min.js`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`OCR engine fetch failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (got !== ESM_SHA) throw new Error('OCR engine integrity check FAILED — refusing to load a tampered bundle.');
  const imported = await import(/* @vite-ignore */ url);
  _mod = imported.default || imported; // tesseract.js ESM exports its API under default
  return _mod;
}

// Spin up (and cache) a worker. onProgress receives Tesseract status messages
// ({status, progress}) so the UI can show a real bar.
export async function getOcrWorker(onProgress) {
  if (_worker) return _worker;
  const { createWorker } = await loadModule();
  const base = dir();
  _worker = await createWorker('eng', 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/tesseract-core-simd-lstm.wasm.js`, // exact file → no feature-detect, deterministic across browsers
    langPath: `${base}/`,                 // dir; contains eng.traineddata.gz
    workerBlobURL: false,                 // load worker from the path (CSP worker-src 'self')
    logger: (m) => { if (m?.status) { emit('ocr:progress', m); onProgress?.(m); } },
  });
  return _worker;
}

// Recognize a canvas (or ImageData/HTMLImage). Returns Tesseract's data plus a flat
// `words` list: { text, words: [{ text, confidence, bbox:{x0,y0,x1,y1} }], ... }.
// v6+ removed `words` from the default result — request `blocks` and flatten the
// blocks→paragraphs→lines→words hierarchy back to the flat list the ops consume.
export async function recognizeCanvas(canvas, onProgress) {
  const worker = await getOcrWorker(onProgress);
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => l.words || [])));
  return { ...data, words };
}

export async function terminateOcr() { if (_worker) { try { await _worker.terminate(); } catch {} _worker = null; } }

export const ocrEngineVersion = VER;
