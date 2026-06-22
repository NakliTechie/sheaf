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
import { openModal, confirmModal, formModal } from './modal.js';
import { toast } from './toast.js';
import { openPdf, newBlank, savePdf, savePdfAs, mergePdf, openFolder } from './fileops.js';
import { openSaveMenu } from './savemenu.js';
import { openConvertMenu } from './convertmenu.js';
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

function btn(iconName, label, onClick, { needsDoc = false, danger = false, id = '', title = '' } = {}) {
  const tip = title || label || iconName;
  const b = el('button', {
    class: `btn ${danger ? 'danger' : ''} ${label ? '' : 'icon'}`,
    title: tip, 'aria-label': tip, onClick, id,
  }, [el('span', { html: icon(iconName) }), label ? el('span.label', { text: label }) : null].filter(Boolean));
  if (needsDoc) need.push(b);
  return b;
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

  // Responsive overflow: re-fold the page ops whenever the toolbar's width changes.
  // Observing the toolbar (not a child) means fit()'s display toggles can't re-trigger
  // it — its border-box stays pinned to the viewport width.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleFit).observe(bar);
  window.addEventListener('resize', scheduleFit);
  scheduleFit();
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
    el('div.sep'),
    el('div.group', {}, [
      btn('save', 'Save', savePdf, { needsDoc: true }),
      btn('saveas', '', openSaveMenu, { needsDoc: true, title: 'Save options' }),
    ]),
    el('div.sep'),
    el('div.group', {}, [
      (undoBtn = btn('undo', '', () => undo(), { needsDoc: true })),
      (redoBtn = btn('redo', '', () => redo(), { needsDoc: true })),
    ]),
    el('div.sep'),
    buildPageOps(),
    el('div.sep'),
    (toolsGroup = el('div.group', {}, [
      toolBtn('cursor', null, 'Select'),
      toolBtn('highlight', 'highlight', 'Highlight'),
      toolBtn('square', 'rect', 'Rectangle'),
      toolBtn('line', 'line', 'Line'),
      toolBtn('pencil', 'pencil', 'Draw'),
      toolBtn('textbox', 'text', 'Text'),
      toolBtn('edittext', 'edittext', 'Edit text (click a line)'),
      toolBtn('eraser', 'whiteout', 'Whiteout & retype'),
      toolBtn('redact', 'redact', 'Redact (true removal)'),
      toolBtn('sign', 'sign', 'Sign'),
      el('input', { type: 'color', value: toolSettings.color, title: 'Annotation colour', class: 'color-swatch',
        onInput: (e) => { toolSettings.color = e.target.value; } }),
    ])),

    el('div.spacer'),
    (fname = el('div.fname', { text: '' })),
    el('div.sep'),
    el('div.group', {}, [
      btn('ai', '', openSidecarMenu, { needsDoc: true }),
      btn(document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun', '', toggleTheme, { id: 'btn-theme' }),
      btn('settings', '', openSettings),
      btn('help', '', openHelp),
    ]),
  );
}

let undoBtn, redoBtn, fname, toolsGroup, pageOpsGroup, moreBtn, pageOps = [];

// Page ops in priority order (most-used first). rotate/trash/copy/insert/scale/merge are
// direct one-click actions; the trailing five open dialogs. fit() folds them from the
// tail into the "More" menu when the toolbar would overflow. The `title` on each inline
// button is preserved verbatim — the guide capture selects these by title at 1600px,
// where nothing folds — while the menu rows get fuller human labels.
function buildPageOps() {
  const make = (iconName, title, menuLabel, run, danger = false) => {
    const b = btn(iconName, '', run, { needsDoc: true, danger, title });
    return { b, iconName, title, menuLabel, danger, run, folded: false };
  };
  pageOps = [
    make('rotate', 'rotate', 'Rotate 90°',         () => dispatch('pages.rotate', { pages: targetPages(), angle: 90 })),
    make('trash',  'trash',  'Delete pages',        onDelete, true),
    make('copy',   'copy',   'Duplicate pages',     () => dispatch('pages.duplicate', { pages: targetPages() })),
    make('insert', 'insert', 'Insert blank page',   onInsert),
    make('scale',  'scale',  'Scale pages…',        onScale),
    make('merge',  'merge',  'Merge a PDF in…',     mergePdf),
    make('mark',   'mark',   'Add marks…',          openMarksMenu),
    make('forms',  'forms',  'Edit form fields…',   openFormsDialog),
    make('ocr',    'ocr',    'OCR text layer…',     openOcrMenu),
    make('download', 'Convert / Export', 'Convert / Export…', openConvertMenu),
    make('info',   'info',   'Document metadata…',  onMetadata),
  ];
  moreBtn = btn('more', '', openMoreMenu, { needsDoc: true, title: 'More actions' });
  moreBtn.id = 'btn-more';
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.style.display = 'none';
  pageOpsGroup = el('div.group', { id: 'pageops' }, [...pageOps.map((p) => p.b), moreBtn]);
  return pageOpsGroup;
}

// Fold the lowest-priority page ops into the More menu until the toolbar fits — pure
// width math on the live layout (no hard-coded breakpoints), so it's correct at any
// width. overflow:hidden in CSS is the backstop; this keeps everything *reachable*.
function fit() {
  if (!bar || !pageOpsGroup) return;
  for (const p of pageOps) { p.b.style.display = ''; p.folded = false; }
  moreBtn.style.display = 'none';
  let i = pageOps.length - 1;
  while (i >= 0 && bar.scrollWidth > bar.clientWidth + 1) {
    pageOps[i].b.style.display = 'none';
    pageOps[i].folded = true;
    moreBtn.style.display = '';
    i -= 1;
  }
}

let fitQueued = false;
function scheduleFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => { fitQueued = false; fit(); });
}

// The folded page ops as a vertical list. Each row runs the same handler as its toolbar
// button and mirrors its disabled (needs-a-document) state.
function openMoreMenu() {
  const folded = pageOps.filter((p) => p.folded);
  if (!folded.length) return;
  const content = ({ close }) => el('div.menu-list', { role: 'menu' }, folded.map((p) =>
    el('button', {
      class: `btn menu-item ${p.danger ? 'danger' : ''}`, role: 'menuitem', disabled: p.b.disabled,
      onClick: async () => { close(); await p.run(); },
    }, [el('span', { html: icon(p.iconName) }), el('span.label', { text: p.menuLabel })])
  ));
  return openModal({ title: 'More actions', content, actions: [{ label: 'Close', value: true }] });
}

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
