// storage.js — the storage façade. FSA (their folder) → OPFS (crash-recovery
// staging) → IndexedDB (fallback, always available). Order matters; mirror down.
//
// SOVEREIGNTY INVARIANT — what may persist, and where:
//   localStorage : UI prefs only (state.js)
//   IndexedDB    : recent FSA handles + the signature library. Nothing else.
//   OPFS         : crash-recovery staging of the working bytes — opt-in, wiped on
//                  clean close. This is the ONE place document bytes may briefly
//                  live, and only to survive a crash; it is not durable persistence.
//   NEVER        : PDF content / page bytes / extracted text / form values in
//                  localStorage or IndexedDB.
//
// Filenames are pinned on first save and never re-derived from a mutable title.

export const hasFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
export const hasOPFS = typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage;

// ── IndexedDB (handles + signatures) ───────────────────────────────────────────

const DB_NAME = 'sheaf';
const DB_VERSION = 1;
let _dbp = null;

function db() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('signatures')) d.createObjectStore('signatures', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbp;
}

async function idbPut(store, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  });
}
async function idbGetAll(store) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []); req.onerror = () => rej(req.error);
  });
}
async function idbDelete(store, id) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  });
}

// Recent FSA handles — store the handle object itself (structured-clonable) so the
// file can be re-opened on a later visit after a permission re-grant. NO bytes.
const MAX_RECENT = 10;
export async function rememberHandle(handle, name) {
  if (!handle) return;
  const id = name || handle.name || String(Math.random());
  await idbPut('handles', { id, handle, name: id, kind: handle.kind, at: nowStamp() });
  const all = (await idbGetAll('handles')).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  for (const old of all.slice(MAX_RECENT)) await idbDelete('handles', old.id);
}
export async function recentHandles() {
  return (await idbGetAll('handles')).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
export async function forgetHandle(id) { return idbDelete('handles', id); }

// Signature library (M4 fills this in; the store + API exist from M0 so Sign rides
// the façade rather than inventing its own storage).
export async function saveSignature(sig) { return idbPut('signatures', sig); }
export async function listSignatures() { return idbGetAll('signatures'); }
export async function deleteSignature(id) { return idbDelete('signatures', id); }

// ── Permission re-grant (FSA handles need it on revisit) ────────────────────────

export async function ensurePermission(handle, mode = 'read') {
  if (!handle?.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

// ── FSA open / save + download fallback ─────────────────────────────────────────

export async function pickAndReadPdf() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    multiple: false,
  });
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { handle, name: file.name, bytes };
}

export function readPdfViaInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ handle: null, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
}

export async function saveToHandle(handle, bytes) {
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

export async function saveAs(bytes, suggestedName) {
  if (hasFSA && window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
    await saveToHandle(handle, bytes);
    return handle;
  }
  downloadBytes(bytes, suggestedName);
  return null;
}

export function downloadBytes(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'document.pdf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── OPFS crash-recovery staging (opt-in; wiped on clean close) ───────────────────

const STAGE_FILE = 'sheaf-working.pdf';
const STAGE_META = 'sheaf-working.json';

export async function stageWorking(bytes, meta = {}) {
  if (!hasOPFS) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(STAGE_FILE, { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
    const mh = await root.getFileHandle(STAGE_META, { create: true });
    const mw = await mh.createWritable(); await mw.write(JSON.stringify({ ...meta, at: nowStamp() })); await mw.close();
    return true;
  } catch { return false; }
}
export async function recoverStaged() {
  if (!hasOPFS) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(STAGE_FILE);
    const meta = await (await (await root.getFileHandle(STAGE_META)).getFile()).text().then(JSON.parse).catch(() => ({}));
    const bytes = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    return { bytes, meta };
  } catch { return null; }
}
export async function clearStage() {
  if (!hasOPFS) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(STAGE_FILE).catch(() => {});
    await root.removeEntry(STAGE_META).catch(() => {});
  } catch {}
}

function nowStamp() { return new Date().toISOString(); }
