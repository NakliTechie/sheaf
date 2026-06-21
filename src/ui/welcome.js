// welcome.js — the empty state. A drag-drop target, Open / New actions, recent
// files (re-opened via stored FSA handles after a permission re-grant), and the
// privacy line. Shown whenever no document is open; the `?` help stays reachable.

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { on, emit } from '../core/events.js';
import { state } from '../core/state.js';
import * as storage from '../core/storage.js';
import { openPdf, newBlank, openBytes } from './fileops.js';
import { ensurePdfLib } from './engines-ui.js';
import { toast } from './toast.js';

let welcome = null, body = null;

export function initWelcome() {
  welcome = document.getElementById('welcome');
  body = document.getElementById('body');
  render();
  on('doc:loaded', updateVisibility);
  on('doc:closed', () => { updateVisibility(); render(); });
  updateVisibility();
  wireGlobalDrop();
}

function updateVisibility() {
  const open = !!state.doc;
  welcome.classList.toggle('hidden', open);
  body.classList.toggle('hidden', !open);
}

async function render() {
  const drop = el('div.drop', {}, [
    el('div', { html: icon('pages'), style: 'width:46px;height:46px;margin:0 auto;color:var(--fg-faint)' }),
    el('h1', { text: 'Open a PDF to start' }),
    el('p', { text: 'Drag a PDF here, or open one from your disk. It is edited entirely in this tab and saved back to your file — nothing is uploaded.' }),
    el('div.actions', {}, [
      el('button', { class: 'btn primary', onClick: openPdf }, [el('span', { html: icon('open') }), el('span.label', { text: 'Open PDF' })]),
      el('button', { class: 'btn', onClick: newBlank }, [el('span', { html: icon('new') }), el('span.label', { text: 'New blank' })]),
    ]),
    el('div.privacy', { html: `${icon('moon')} <span>No account · no upload · no telemetry · works offline</span>`, style: 'justify-content:center;margin-top:4px' }),
  ]);
  clear(welcome).append(drop);
  renderRecent();
}

async function renderRecent() {
  try {
    const recents = await storage.recentHandles();
    if (!recents.length) return;
    const list = el('div', { style: 'margin-top:8px;font-size:13px' }, [
      el('div', { text: 'Recent', style: 'color:var(--fg-faint);margin-bottom:6px' }),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:520px' },
        recents.slice(0, 6).map(r => el('button', {
          class: 'btn', style: 'font-size:12px',
          title: 'Re-open (will ask permission)',
          onClick: () => reopen(r),
        }, [r.name]))),
    ]);
    welcome.append(list);
  } catch {}
}

async function reopen(rec) {
  try {
    if (!await storage.ensurePermission(rec.handle, 'read')) return toast('Permission denied', 'warn');
    await ensurePdfLib();
    const file = await rec.handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes, file.name, rec.handle);
    toast(`Opened ${file.name}`, 'ok');
  } catch (err) {
    emit('error', { message: 'Could not re-open', detail: err.message });
  }
}

function wireGlobalDrop() {
  const app = document.getElementById('app');
  const dropEl = () => welcome.querySelector('.drop');
  app.addEventListener('dragover', (e) => { e.preventDefault(); dropEl()?.classList.add('over'); });
  app.addEventListener('dragleave', (e) => { if (e.target === app) dropEl()?.classList.remove('over'); });
  app.addEventListener('drop', async (e) => {
    e.preventDefault(); dropEl()?.classList.remove('over');
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!file) return;
    try {
      await ensurePdfLib();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await openBytes(bytes, file.name, null);
      toast(`Opened ${file.name}`, 'ok');
    } catch (err) { emit('error', { message: 'Could not open dropped file', detail: err.message }); }
  });
}
