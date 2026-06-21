// toolbar.js — the top chrome. Buttons dispatch through the runner (the same door
// the agent face uses). Page ops act on the selected pages, or the current page when
// nothing is selected. Buttons that need a document disable when none is open.

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { on, emit } from '../core/events.js';
import { dispatch, undo, redo, historyStatus } from '../core/runner.js';
import { savePrefs } from '../core/state.js';
import { selectedPages } from './thumbs.js';
import { confirmModal, formModal } from './modal.js';
import { toast } from './toast.js';
import { openPdf, newBlank, savePdf, savePdfAs, mergePdf } from './fileops.js';
import { openSettings } from './settings.js';
import { openHelp } from './help.js';

let bar = null;
const need = [];   // buttons needing a document

function targetPages() {
  const sel = selectedPages();
  return sel.length ? sel : [state.view.pageIndex];
}

function btn(iconName, label, onClick, { needsDoc = false, danger = false, id = '' } = {}) {
  const b = el('button', {
    class: `btn ${danger ? 'danger' : ''} ${label ? '' : 'icon'}`,
    title: label || iconName, 'aria-label': label || iconName, onClick, id,
  }, [el('span', { html: icon(iconName) }), label ? el('span.label', { text: label }) : null].filter(Boolean));
  if (needsDoc) need.push(b);
  return b;
}

export function initToolbar() {
  bar = document.getElementById('toolbar');
  const v = document.getElementById('app').dataset.version || '';
  render(v);

  on('doc:loaded', refresh);
  on('doc:closed', refresh);
  on('session:changed', refresh);
  on('history:changed', refresh);
  on('dirty:changed', refresh);
  refresh();
}

function render(version) {
  clear(bar).append(
    el('div.brand', {}, [el('b', { text: 'Sheaf' }), el('span.ver', { text: `v${version}` })]),

    el('div.group', {}, [
      btn('open', 'Open', openPdf),
      btn('new', '', newBlank, { id: 'btn-new' }),
    ]),
    el('div.sep'),
    el('div.group', {}, [
      btn('save', 'Save', savePdf, { needsDoc: true }),
      btn('saveas', '', savePdfAs, { needsDoc: true }),
    ]),
    el('div.sep'),
    el('div.group', {}, [
      (undoBtn = btn('undo', '', () => undo(), { needsDoc: true })),
      (redoBtn = btn('redo', '', () => redo(), { needsDoc: true })),
    ]),
    el('div.sep'),
    el('div.group', {}, [
      btn('rotate', '', () => dispatch('pages.rotate', { pages: targetPages(), angle: 90 }), { needsDoc: true }),
      btn('trash', '', onDelete, { needsDoc: true, danger: true }),
      btn('copy', '', () => dispatch('pages.duplicate', { pages: targetPages() }), { needsDoc: true }),
      btn('insert', '', onInsert, { needsDoc: true }),
      btn('scale', '', onScale, { needsDoc: true }),
      btn('merge', '', mergePdf, { needsDoc: true }),
      btn('info', '', onMetadata, { needsDoc: true }),
    ]),

    el('div.spacer'),
    (fname = el('div.fname', { text: '' })),
    el('div.sep'),
    el('div.group', {}, [
      btn(document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun', '', toggleTheme, { id: 'btn-theme' }),
      btn('settings', '', openSettings),
      btn('help', '', openHelp),
    ]),
  );
}

let undoBtn, redoBtn, fname;

function refresh() {
  const open = !!state.doc;
  for (const b of need) b.disabled = !open;
  if (undoBtn && redoBtn) { const h = historyStatus(); undoBtn.disabled = !h.canUndo; redoBtn.disabled = !h.canRedo; }
  if (fname) {
    const name = state.session.fileName;
    clear(fname);
    if (name) { fname.append(name); if (state.dirty) fname.append(el('span.dot', { text: ' ●', title: 'Unsaved changes' })); }
  }
}

async function onDelete() {
  const pages = targetPages();
  if (pages.length >= state.doc.pageCount()) return toast('Cannot delete every page', 'warn');
  const ok = await confirmModal(`Delete ${pages.length} page${pages.length > 1 ? 's' : ''}? This removes them from the document.`, { title: 'Delete pages', okLabel: 'Delete', danger: true });
  if (ok) dispatch('pages.delete', { pages });
}

async function onInsert() {
  const at = Math.min(state.view.pageIndex + 1, state.doc.pageCount());
  await dispatch('pages.insertBlank', { at });
  toast(`Inserted a blank page at ${at + 1}`, 'ok');
}

async function onScale() {
  const v = await formModal('Scale pages', [
    { name: 'factor', label: 'Scale factor (1 = unchanged)', type: 'number', value: 1, min: 0.05, max: 20 },
  ]);
  if (v && v.factor) dispatch('pages.scale', { pages: targetPages(), factor: v.factor });
}

async function onMetadata() {
  const m = state.doc.getMetadata();
  const v = await formModal('Edit metadata', [
    { name: 'title', label: 'Title', value: m.title || '' },
    { name: 'author', label: 'Author', value: m.author || '' },
    { name: 'subject', label: 'Subject', value: m.subject || '' },
    { name: 'keywords', label: 'Keywords (comma-separated)', value: m.keywords || '' },
  ]);
  if (v) dispatch('metadata.set', v);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  savePrefs();
  const tb = document.getElementById('btn-theme');
  if (tb) tb.querySelector('span').innerHTML = icon(next === 'light' ? 'moon' : 'sun');
}
