// rendoc.js — owns the lifecycle of the current PDF.js render proxy. The structure
// model (doc.js) is the source of truth; whenever it changes we re-derive pixels
// from its bytes. A monotonic token guards against an older rebuild finishing after
// a newer one (op spam / fast undo-redo).

import { openForRender } from '../core/render.js';
import { state } from '../core/state.js';
import { on, emit } from '../core/events.js';

let _pdf = null;
let _token = 0;

export function currentRenderDoc() { return _pdf; }

async function rebuild() {
  const my = ++_token;
  if (!_pdf && !state.doc) return;
  if (!state.doc) { destroy(); emit('rendoc:cleared', null); return; }
  let bytes, pdf;
  try {
    bytes = await state.doc.toBytes();
    pdf = await openForRender(bytes);
  } catch (e) {
    emit('error', { message: 'Could not render the document', detail: e.message });
    return;
  }
  if (my !== _token) { pdf.destroy?.(); return; } // superseded
  if (_pdf) _pdf.destroy?.();
  _pdf = pdf;
  emit('rendoc:ready', { pageCount: pdf.numPages });
}

function destroy() { if (_pdf) { _pdf.destroy?.(); _pdf = null; } }

export function initRenderDoc() {
  on('doc:loaded', rebuild);
  on('doc:changed', rebuild);
  on('doc:closed', () => { destroy(); emit('rendoc:cleared', null); });
}
