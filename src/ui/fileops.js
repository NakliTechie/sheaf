// fileops.js — the storage-facing flows: open, save, save-as, merge. These wrap the
// runner (open/merge are registry ops) and the storage façade (FSA / download). The
// filename is pinned on first save and never re-derived from a mutable title.

import { state, markDirty } from '../core/state.js';
import { dispatch } from '../core/runner.js';
import { emit } from '../core/events.js';
import * as storage from '../core/storage.js';
import { toast } from './toast.js';
import { ensurePdfLib } from './engines-ui.js';

export async function openPdf() {
  try {
    const picked = storage.hasFSA ? await storage.pickAndReadPdf() : await storage.readPdfViaInput();
    if (!picked) return;
    await ensurePdfLib();
    await dispatch('open.bytes', { bytes: picked.bytes });
    state.session.fileName = picked.name;
    state.session.fileHandle = picked.handle || null;
    state.session.source = picked.handle ? 'fsa' : 'picker';
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
  emit('session:changed', null);
}

export async function newBlank() {
  await ensurePdfLib();
  await dispatch('open.blank', { pages: 1 });
  state.session.fileName = 'untitled.pdf';
  state.session.fileHandle = null;
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
