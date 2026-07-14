// engines.js — vendored-engine loader. Probe → lazy-load on first use → verify
// SHA-256 → cache. Fail loud on mismatch. No runtime CDN; everything is served
// same-origin from /engines. Never surprise-download multi-MB assets — callers
// gate the first load behind an explicit action.
//
// Engines are dependency-injected so the deterministic core stays testable:
// the browser bootstrap calls loadEngine(); a Node test calls registerEngine()
// with a directly-imported module. Either way ops read engines via getEngine().

// The pin manifest. Paths are relative to ENGINES_BASE; sha256 is verified before
// the module is allowed to execute. Bump version + sha together, never one alone.
export const MANIFEST = {
  'pdf-lib': {
    version: '1.17.1',
    path: 'pdf-lib/1.17.1/pdf-lib.esm.js',
    sha256: '4bd8dd3155d7b1062a161567bf68168c55283bd5fad6a638b16ae028846b52c5',
    sizeHint: '1.5 MB',
  },
  'pdfjs': {
    version: '6.1.200',
    path: 'pdfjs/6.1.200/pdf.min.mjs',
    sha256: '4ba2f15599b03fde8755ad91349920c21dadd3e8fd6b6460a7663d46d4cf21b5',
    sizeHint: '450 KB',
    worker: {
      path: 'pdfjs/6.1.200/pdf.worker.min.mjs',
      sha256: '2ab9e09667296dab1a618868b3ce6e6c23d5b8f48120ae7c5b34e7e335ed01fa',
    },
  },
  // Tesseract is loaded by core/ocr.js (multi-file: worker + embedded-wasm core + lang),
  // not through loadEngine — recorded here as the integrity pin + version-of-record.
  'tesseract': {
    version: '7.0.0',
    integrity: {
      'tesseract.esm.min.js': '64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29',
      'worker.min.js': '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',
      'tesseract-core-simd-lstm.wasm.js': 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',
      'eng.traineddata.gz': '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
    },
    sizeHint: '6.5 MB',
  },
};

let BASE = '/engines';
export function setEnginesBase(p) { BASE = p.replace(/\/$/, ''); }
export function enginesBase() { return BASE; }

const _loaded = new Map();   // name -> module
const _loading = new Map();  // name -> Promise

export function registerEngine(name, mod) { _loaded.set(name, mod); }
export function getEngine(name) {
  const m = _loaded.get(name);
  if (!m) throw new Error(`Engine "${name}" not loaded — call loadEngine() first`);
  return m;
}
export function isLoaded(name) { return _loaded.has(name); }

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fetch the vendored file, verify its hash, then import it. The verify-then-import
// uses a same-origin re-fetch (served from cache); the hash is a tamper tripwire on
// the vendored bundle, not an anti-MITM measure (same-origin already gives us that).
export async function loadEngine(name) {
  if (_loaded.has(name)) return _loaded.get(name);
  if (_loading.has(name)) return _loading.get(name);

  const entry = MANIFEST[name];
  if (!entry) throw new Error(`Unknown engine "${name}"`);

  const p = (async () => {
    const url = `${BASE}/${entry.path}`;
    let bytes;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = await res.arrayBuffer();
    } catch (err) {
      throw new Error(`Engine "${name}" failed to load from ${url}: ${err.message}`);
    }
    const got = await sha256Hex(bytes);
    if (got !== entry.sha256) {
      throw new Error(`Engine "${name}" integrity check FAILED — expected ${entry.sha256}, got ${got}. Refusing to load a tampered bundle.`);
    }
    const mod = await import(/* @vite-ignore */ url);
    _loaded.set(name, mod);
    return mod;
  })();

  _loading.set(name, p);
  try { return await p; }
  finally { _loading.delete(name); }
}

// PDF.js needs its worker pinned too. Returns the same-origin worker URL after the
// engine is loaded; the caller assigns GlobalWorkerOptions.workerSrc.
export function pdfjsWorkerUrl() {
  return `${BASE}/${MANIFEST.pdfjs.worker.path}`;
}
