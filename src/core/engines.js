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
    version: '4.10.38',
    path: 'pdfjs/4.10.38/pdf.min.mjs',
    sha256: '27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c',
    sizeHint: '350 KB',
    worker: {
      path: 'pdfjs/4.10.38/pdf.worker.min.mjs',
      sha256: '1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36',
    },
  },
  // Tesseract is loaded by core/ocr.js (multi-file: worker + embedded-wasm core + lang),
  // not through loadEngine — recorded here as the integrity pin + version-of-record.
  'tesseract': {
    version: '5.1.1',
    integrity: {
      'tesseract.esm.min.js': '2537be686335e4b2637e933cdc85a52dd80267a592689c1bd63235c8591540ae',
      'worker.min.js': 'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc',
      'tesseract-core-simd-lstm.wasm.js': 'ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf',
      'eng.traineddata.gz': '18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',
    },
    sizeHint: '6.6 MB',
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
