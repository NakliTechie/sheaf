// toolbar.js — the top chrome. Buttons dispatch through the runner (the same door
// the agent face uses). Page ops act on the selected pages, or the current page when
// nothing is selected. Buttons that need a document disable when none is open.

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { state, savePrefs } from '../core/state.js';
import { on } from '../core/events.js';
import { dispatch, undo, redo, historyStatus } from '../core/runner.js';
import { selectedPages } from './thumbs.js';
import { openModal, confirmModal, formModal } from './modal.js';
import { toast } from './toast.js';
import { openPdf, newBlank, savePdf, savePdfAs, mergePdf, openFolder } from './fileops.js';
import { openSaveMenu } from './savemenu.js';
import { openConvertMenu, imagesToPdf } from './convertmenu.js';
import { openSettings } from './settings.js';
import { openHelp } from './help.js';
import { openMarksMenu } from './marksmenu.js';
import { setTool, currentTool, toolSettings } from './annotate-tools.js';
import { openFormsDialog } from './formsdialog.js';
import { openSidecarMenu } from './sidecar-menu.js';
import { openOcrMenu } from './ocr-menu.js';
import { hasFSA } from '../core/storage.js';

let bar = null;
const need = [];   // buttons needing a document

function targetPages() {
  const sel = selectedPages();
  return sel.length ? sel : [state.view.pageIndex];
}

// Dispatch a page op and surface a SPECIFIC error if it rejects (e.g. keepRange from>to),
// instead of letting it fall to the global net's generic "something went wrong" (L3).
async function runOp(id, params) {
  try { await dispatch(id, params); }
  catch (e) { toast('That action could not be applied', 'err', { detail: e.message }); }
}

function btn(iconName, label, onClick, { needsDoc = false, danger = false, id = '', title = '' } = {}) {
  const tip = title || label || iconName;
  const b = el('button', {
    class: `btn ${danger ? 'danger' : ''} ${label ? '' : 'icon'}`,
    title: tip, 'aria-label': tip, onClick, id,
  }, [el('span', { html: icon(iconName) }), label ? el('span.label', { text: label }) : null].filter(Boolean));
  if (needsDoc) need.push(b);
  return b;
}

// A labelled dropdown button that opens a grouped menu of page ops (Arrange/Transform/
// Insert). Replaces the old flat 17-icon page-op row — fewer, self-labelling, predictable.
function dropdown(iconName, label, items) {
  const b = btn(iconName, label, () => openDropdownMenu(label, items), { needsDoc: true, title: label });
  b.classList.add('dropdown');
  b.setAttribute('aria-haspopup', 'menu');
  b.append(el('span.caret', { html: icon('chevdown') }));
  return b;
}

function openDropdownMenu(title, items) {
  const content = ({ close }) => el('div.menu-list', { role: 'menu' }, items.map((it) =>
    el('button', {
      class: `btn menu-item ${it.danger ? 'danger' : ''}`, role: 'menuitem',
      onClick: async () => { close(); await runItem(it.run); },
    }, [el('span', { html: icon(it.icon) }), el('span.label', { text: it.label })])
  ));
  return openModal({ title, content, actions: [{ label: 'Close', value: true }] });
}

async function runItem(fn) {
  try { await fn(); }
  catch (e) { toast('That action could not be applied', 'err', { detail: e.message }); }
}

// Annotation tool toggle button. tool === null → the select/cursor (clears the tool).
function toolBtn(iconName, tool, label) {
  const b = el('button', {
    class: 'btn icon tool', title: label, 'aria-label': label, 'aria-pressed': 'false',
    dataset: { tool: tool || 'cursor' },
    onClick: () => setTool(currentTool() === tool ? null : tool),
  }, [el('span', { html: icon(iconName) })]);
  need.push(b);
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
  on('tool:changed', ({ tool }) => reflectTool(tool));
  on('theme:changed', ({ theme }) => { const tb = document.getElementById('btn-theme'); if (tb) tb.querySelector('span').innerHTML = icon(theme === 'light' ? 'moon' : 'sun'); });
  refresh();
}

function reflectTool(tool) {
  if (!toolsGroup) return;
  for (const b of toolsGroup.querySelectorAll('button.tool')) {
    const isActive = b.dataset.tool === (tool || 'cursor');
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', String(isActive));
  }
}

function render(version) {
  clear(bar).append(
    el('div.brand', {}, [el('b', { text: 'Sheaf' }), el('span.ver', { text: `v${version}` })]),

    el('div.group', {}, [
      btn('open', 'Open', openPdf),
      // Folder mode needs File System Access — omit the button entirely on Firefox/Safari.
      hasFSA ? btn('openfolder', '', openFolder, { title: 'Open folder of PDFs' }) : null,
      btn('new', '', newBlank, { id: 'btn-new' }),
    ].filter(Boolean)),
    el('div.sep.doc-only'),
    el('div.group.doc-only', {}, [
      btn('save', 'Save', savePdf, { needsDoc: true }),
      btn('saveas', '', openSaveMenu, { needsDoc: true, title: 'Save options' }),
    ]),
    el('div.sep.doc-only'),
    el('div.group.doc-only', {}, [
      (undoBtn = btn('undo', '', () => undo(), { needsDoc: true })),
      (redoBtn = btn('redo', '', () => redo(), { needsDoc: true })),
    ]),
    el('div.sep.doc-only'),
    buildPageOps(),
    el('div.sep.doc-only'),
    (toolsGroup = el('div.group.doc-only', { id: 'tb-tools' }, [
      toolBtn('cursor', null, 'Select'),
      toolBtn('highlight', 'highlight', 'Highlight'),
      toolBtn('square', 'rect', 'Rectangle'),
      toolBtn('line', 'line', 'Line'),
      toolBtn('pencil', 'pencil', 'Draw'),
      toolBtn('textbox', 'text', 'Text'),
      toolBtn('edittext', 'edittext', 'Edit text (click a line)'),
      toolBtn('eraser', 'whiteout', 'Whiteout & retype'),
      toolBtn('redact', 'redact', 'Redact (true removal)'),
      toolBtn('crop', 'crop', 'Crop (draw the keep area)'),
      toolBtn('sign', 'sign', 'Sign'),
      el('input', { type: 'color', value: toolSettings.color, title: 'Annotation colour', class: 'color-swatch',
        onInput: (e) => { toolSettings.color = e.target.value; } }),
    ])),

    el('div.spacer'),
    (fname = el('div.fname.doc-only', { text: '' })),
    el('div.sep.doc-only'),
    el('div.group.doc-only', {}, [
      btn('ai', '', openSidecarMenu, { needsDoc: true, id: 'tb-ai' }),
    ]),
    el('div.sep'),
    el('div.group', {}, [
      btn(document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun', '', toggleTheme, { id: 'btn-theme' }),
      btn('settings', '', openSettings),
      btn('help', '', openHelp, { id: 'tb-help' }),
    ]),
  );
}

let undoBtn, redoBtn, fname, toolsGroup, opGroup;

// Page ops as three task-grouped dropdowns (Arrange / Transform / Insert) + the dialog
// openers (Marks / Forms / OCR / Export / Metadata). Grouping by task — not build order —
// so a newcomer can predict where an op lives, and the toolbar stays compact enough that
// the old overflow-fold ("More" menu) is no longer needed.
function buildPageOps() {
  const arrange = [
    { icon: 'reorder', label: 'Reverse page order', run: () => runOp('pages.reverse', {}) },
    { icon: 'trash', label: 'Delete pages', run: onDelete, danger: true },
    { icon: 'copy', label: 'Duplicate pages', run: () => runOp('pages.duplicate', { pages: targetPages() }) },
    { icon: 'extract', label: 'Keep only selected pages', run: () => runOp('pages.extract', { pages: targetPages() }) },
    { icon: 'extract', label: 'Keep page range…', run: onKeepRange },
  ];
  const transform = [
    { icon: 'rotate', label: 'Rotate 90°', run: () => runOp('pages.rotate', { pages: targetPages(), angle: 90 }) },
    { icon: 'rotate', label: 'Set orientation…', run: onOrient },
    { icon: 'scale', label: 'Scale pages…', run: onScale },
    { icon: 'crop', label: 'Crop (draw the keep area)', run: () => setTool('crop') },
    { icon: 'scale', label: 'Add margins…', run: onAddMargin },
    { icon: 'scale', label: 'N-up (2/4 per sheet)…', run: onNUp },
  ];
  const insert = [
    { icon: 'insert', label: 'Blank page', run: onInsert },
    { icon: 'imgpdf', label: 'Images → PDF…', run: imagesToPdf },
    { icon: 'merge', label: 'Merge a PDF in…', run: mergePdf },
  ];
  opGroup = el('div.group.doc-only', { id: 'pageops' }, [
    dropdown('reorder', 'Arrange', arrange),
    dropdown('scale', 'Transform', transform),
    dropdown('insert', 'Insert', insert),
    el('div.sep'),
    btn('mark', '', openMarksMenu, { needsDoc: true, title: 'Add marks…' }),
    btn('forms', '', openFormsDialog, { needsDoc: true, title: 'Edit form fields…' }),
    btn('ocr', '', openOcrMenu, { needsDoc: true, title: 'OCR text layer…' }),
    btn('download', 'Export', openConvertMenu, { needsDoc: true, title: 'Convert / Export…' }),
    btn('info', '', onMetadata, { needsDoc: true, title: 'Document metadata…' }),
  ]);
  return opGroup;
}

function refresh() {
  const open = !!state.doc;
  // Minimal chrome on the empty state: the .doc-only groups (save/undo/page ops/tools/AI)
  // are hidden until a document is open, so a newcomer isn't met by a wall of greyed icons.
  if (bar) bar.classList.toggle('has-doc', open);
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

async function onOrient() {
  const v = await formModal('Set orientation', [
    { name: 'angle', label: 'Rotation', type: 'select', value: '0',
      options: ['0', '90', '180', '270'].map(o => ({ value: o, label: `${o}°` })) },
  ]);
  if (v) runOp('pages.orient', { pages: targetPages(), angle: Number(v.angle) });
}

async function onKeepRange() {
  const n = state.doc.pageCount();
  const v = await formModal('Keep page range', [
    { name: 'from', label: `First page to keep (1–${n})`, type: 'number', value: 1, min: 1, max: n },
    { name: 'to', label: `Last page to keep (1–${n})`, type: 'number', value: n, min: 1, max: n },
  ]);
  if (v) runOp('pages.keepRange', { from: (v.from | 0) - 1, to: (v.to | 0) - 1 });
}

async function onNUp() {
  const v = await formModal('N-up (pages per sheet)', [
    { name: 'perSheet', label: 'Pages per sheet', type: 'select', value: '2',
      options: [{ value: '2', label: '2 per sheet' }, { value: '4', label: '4 per sheet' }] },
  ]);
  if (v) runOp('pages.nUp', { perSheet: Number(v.perSheet) });
}

async function onAddMargin() {
  const v = await formModal('Add margins', [
    { name: 'margin', label: 'Margin (pt) added on every side', type: 'number', value: 36, min: 0, max: 400 },
  ]);
  if (v && v.margin) runOp('pages.addMargin', { margin: v.margin, pages: targetPages() });
}

async function onScale() {
  const v = await formModal('Scale pages', [
    { name: 'factor', label: 'Scale factor (1 = unchanged)', type: 'number', value: 1, min: 0.05, max: 20 },
  ]);
  if (v && v.factor) runOp('pages.scale', { pages: targetPages(), factor: v.factor });
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
