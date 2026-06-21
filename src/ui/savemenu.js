// savemenu.js — the Save options (beyond the primary Save = overwrite-in-place).
// Save As (new file), Save a copy (timestamped sidecar that never touches the
// original — the safe way to version a PDF), and Download.

import { el } from './dom.js';
import { openModal } from './modal.js';
import { state } from '../core/state.js';
import { savePdfAs, saveCopy } from './fileops.js';
import * as storage from '../core/storage.js';
import { toast } from './toast.js';

export function openSaveMenu() {
  if (!state.doc) return;
  let close;
  const item = (label, desc, fn) => el('button', {
    class: 'btn', style: 'justify-content:flex-start;width:100%;text-align:left;height:auto;padding:10px 12px;flex-direction:column;align-items:flex-start;gap:2px',
    onClick: async () => { close(); await fn(); },
  }, [el('span', { text: label, style: 'font-size:14px' }), el('span', { text: desc, style: 'font-size:12px;color:var(--fg-faint)' })]);

  const folderKnown = !!state.session.folderHandle;
  const content = ({ close: c }) => { close = c; return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    item('Save as…', 'Write to a new file and keep editing it', savePdfAs),
    item('Save a copy', folderKnown ? 'Timestamped copy in the current folder — original untouched' : 'Pick a folder; saves a timestamped copy there — original untouched', saveCopy),
    item('Download', 'Download a copy to your device', downloadCopy),
  ]); };
  return openModal({ title: 'Save', content, actions: [{ label: 'Close', value: true }] });
}

async function downloadCopy() {
  if (!state.doc) return;
  const base = (state.session.fileName || 'document').replace(/\.pdf$/i, '');
  storage.downloadBytes(await state.doc.toBytes(), `${base}.pdf`);
  toast('Downloaded', 'ok');
}
