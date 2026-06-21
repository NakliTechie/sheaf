// fileops.js — the storage-facing flows: open, save, save-as, merge. These wrap the
// runner (open/merge are registry ops) and the storage façade (FSA / download). The
// filename is pinned on first save and never re-derived from a mutable title.

import { state, markDirty } from '../core/state.js';
import { dispatch } from '../core/runner.js';
import { emit } from '../core/events.js';
import * as storage from '../core/storage.js';
import { toast } from './toast.js';
import { ensurePdfLib } from './engines-ui.js';
import { confirmModal } from './modal.js';

// Single-document opens leave "folder mode" — clear the file list so the stepper hides.
function exitFolderMode() {
  state.session.files = [];
  state.session.currentIndex = 0;
  emit('folder:changed', null);
}

export async function openPdf() {
  try {
    const picked = storage.hasFSA ? await storage.pickAndReadPdf() : await storage.readPdfViaInput();
    if (!picked) return;
    await ensurePdfLib();
    await dispatch('open.bytes', { bytes: picked.bytes });
    state.session.fileName = picked.name;
    state.session.fileHandle = picked.handle || null;
    state.session.source = picked.handle ? 'fsa' : 'picker';
    exitFolderMode();
    if (picked.handle) storage.rememberHandle(picked.handle, picked.name).catch(() => {});
    emit('session:changed', null);
    toast(`Opened ${picked.name}`, 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') emit('error', { message: 'Could not open PDF', detail: err.message });
  }
}

export async function openBytes(bytes, name = 'document.pdf', handle = null) {
  await ensurePdfLib();
  await dispatch('open.bytes', { bytes });
  state.session.fileName = name;
  state.session.fileHandle = handle;
  exitFolderMode();
  emit('session:changed', null);
}

export async function newBlank() {
  await ensurePdfLib();
  await dispatch('open.blank', { pages: 1 });
  state.session.fileName = 'untitled.pdf';
  state.session.fileHandle = null;
  exitFolderMode();
  emit('session:changed', null);
}

export async function savePdf() {
  if (!state.doc) return;
  const handle = state.session.fileHandle;
  if (!handle) return savePdfAs();
  try {
    if (!await storage.ensurePermission(handle, 'readwrite')) return savePdfAs();
    const bytes = await state.doc.toBytes();
    await storage.saveToHandle(handle, bytes);
    markDirty(false);
    toast(`Saved ${state.session.fileName || 'document'}`, 'ok');
  } catch (err) {
    emit('error', { message: 'Save failed', detail: err.message });
  }
}

export async function savePdfAs() {
  if (!state.doc) return;
  try {
    const bytes = await state.doc.toBytes();
    const name = state.session.fileName || 'document.pdf';
    const handle = await storage.saveAs(bytes, name);
    if (handle) {
      state.session.fileHandle = handle;
      state.session.fileName = handle.name; // pin
      storage.rememberHandle(handle, handle.name).catch(() => {});
      emit('session:changed', null);
    }
    markDirty(false);
    toast('Saved', 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') emit('error', { message: 'Save failed', detail: err.message });
  }
}

// ── Save a copy (sidecar) — never touches the original ──────────────────────────
// Saves a timestamped copy into the known folder (folder mode / a chosen workspace),
// or downloads one when File System Access isn't available. The open document and the
// original file are left exactly as they are — the safe way to version a PDF.
export async function saveCopy() {
  if (!state.doc) return;
  try {
    const bytes = await state.doc.toBytes();
    const base = (state.session.fileName || 'document').replace(/\.pdf$/i, '');
    if (!storage.hasFSA) { storage.downloadBytes(bytes, `${base}-${storage.tstamp()}.pdf`); return toast('Downloaded a copy', 'ok'); }
    let dir = state.session.folderHandle;
    if (!dir) { dir = await storage.pickWorkspaceFolder(); state.session.folderHandle = dir; }
    const name = await storage.saveSidecar(dir, bytes, base);
    toast(`Saved a copy — ${name}`, 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') emit('error', { message: 'Could not save a copy', detail: err.message });
  }
}

// ── Folder mode — open a folder of PDFs and step through them ────────────────────
export async function openFolder() {
  if (!storage.hasFSA) return toast('Folder mode needs a Chromium browser (Chrome / Edge / Brave / Arc)', 'warn');
  try {
    const { dirHandle, files } = await storage.pickFolder();
    if (!files.length) return toast('No PDFs found in that folder', 'warn');
    state.session.folderHandle = dirHandle;
    state.session.files = files.map((f, i) => ({ ...f, index: i }));
    await openFileAt(0, { skipDirtyCheck: true });
    emit('folder:changed', { count: files.length });
    toast(`Opened folder — ${files.length} PDF${files.length > 1 ? 's' : ''}`, 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') emit('error', { message: 'Could not open folder', detail: err.message });
  }
}

export async function openFileAt(index, { skipDirtyCheck = false } = {}) {
  const files = state.session.files;
  if (!files.length) return;
  const i = Math.max(0, Math.min(index, files.length - 1));
  if (i === state.session.currentIndex && !skipDirtyCheck && state.doc) return;
  const entry = files[i];
  if (!skipDirtyCheck && state.dirty) {
    const ok = await confirmModal(`Discard unsaved changes to ${state.session.fileName}?`, { title: 'Unsaved changes', okLabel: 'Discard', danger: true });
    if (!ok) return;
  }
  try {
    if (!await storage.ensurePermission(entry.handle, 'read')) return toast('Permission denied', 'warn');
    await ensurePdfLib();
    const file = await entry.handle.getFile();
    await dispatch('open.bytes', { bytes: new Uint8Array(await file.arrayBuffer()) });
    state.session.fileName = entry.name;
    state.session.fileHandle = entry.handle;
    state.session.currentIndex = i;
    emit('file:changed', { index: i, total: files.length, name: entry.name });
    emit('session:changed', null);
  } catch (err) {
    emit('error', { message: `Could not open ${entry.name}`, detail: err.message });
  }
}

export const nextFile = () => openFileAt(state.session.currentIndex + 1);
export const prevFile = () => openFileAt(state.session.currentIndex - 1);

export async function mergePdf() {
  if (!state.doc) return;
  try {
    const picked = storage.hasFSA ? await storage.pickAndReadPdf() : await storage.readPdfViaInput();
    if (!picked) return;
    await dispatch('pages.merge', { bytes: picked.bytes, position: 'end' }, { source: 'ui' });
    toast(`Merged ${picked.name}`, 'ok');
  } catch (err) {
    if (err?.name !== 'AbortError') emit('error', { message: 'Merge failed', detail: err.message });
  }
}
