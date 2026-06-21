// engines-ui.js — UI-side lazy loading of the core engines, with a loading-bar
// signal. pdf-lib and pdfjs are document engines (not models), so they load on first
// use without a prompt; the prompt-first rule is reserved for multi-MB models
// (Tesseract language data, the AI sidecar) which come in later milestones.

import { loadEngine, isLoaded } from '../core/engines.js';
import { emit } from '../core/events.js';

let _pdfLib = null;

export async function ensurePdfLib() {
  if (isLoaded('pdf-lib')) return;
  if (!_pdfLib) {
    emit('loading', { on: true });
    _pdfLib = loadEngine('pdf-lib')
      .catch((e) => { emit('error', { message: 'Could not load the PDF engine', detail: e.message }); throw e; })
      .finally(() => emit('loading', { on: false }));
  }
  return _pdfLib;
}
