// recovery.js — crash recovery via the OPFS staging layer. While you have unsaved
// edits, the working bytes are staged to OPFS (debounced); if the tab crashes or is
// closed before saving, the next visit offers to recover them. The stage is CLEARED
// the moment you save (or discard) — so PDF bytes only ever live on disk transiently,
// as in-flight unsaved work, never as durable persistence. This is the one place a
// document's bytes touch disk, and it is self-cleaning.

import { state } from '../core/state.js';
import { on } from '../core/events.js';
import * as storage from '../core/storage.js';
import { el } from './dom.js';
import { openBytes } from './fileops.js';

const STAGE_DEBOUNCE = 3000;
let timer = null;

export async function initRecovery() {
  if (!storage.hasOPFS) return; // no OPFS → no crash staging (Firefox/Safari degrade)

  on('doc:changed', scheduleStage);              // edits → stage soon
  on('dirty:changed', ({ dirty }) => { if (!dirty) { clearTimeout(timer); storage.clearStage(); } }); // saved/opened → safe, clear
  on('doc:closed', () => { clearTimeout(timer); storage.clearStage(); });

  // Offer recovery on boot, BEFORE any document loads (a fresh open clears the stage).
  try {
    const staged = await storage.recoverStaged();
    if (staged?.bytes?.length) offerRecovery(staged);
  } catch {}
}

function scheduleStage() {
  if (!state.doc) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!state.dirty || !state.doc) return;
    try { await storage.stageWorking(await state.doc.toBytes(), { fileName: state.session.fileName }); } catch {}
  }, STAGE_DEBOUNCE);
}

function offerRecovery(staged) {
  const name = staged.meta?.fileName || 'an untitled document';
  const banner = el('div', { class: 'recovery-banner', role: 'alert' }, [
    el('span', { html: `Unsaved changes to <b>${escapeHtml(name)}</b> from your last session were found.` }),
    el('div', { style: 'display:flex;gap:8px' }, [
      el('button', {
        class: 'btn primary', onClick: async () => { banner.remove(); await openBytes(staged.bytes, name); },
      }, ['Recover']),
      el('button', { class: 'btn', onClick: () => { banner.remove(); storage.clearStage(); } }, ['Discard']),
    ]),
  ]);
  const app = document.getElementById('app');
  app.insertBefore(banner, app.querySelector('#welcome'));
  // If the user opens something else instead, drop the banner (the stage gets superseded
  // by the new doc's edits, or cleared on its save).
  on('doc:loaded', () => banner.remove());
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
