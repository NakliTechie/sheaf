// statusbar.js — page position + zoom. Compact, bottom of the shell.

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { on } from '../core/events.js';
import { zoomBy, setFitMode, currentScalePct } from './viewer.js';
import { nextFile, prevFile } from './fileops.js';

let bar = null, pageLabel = null, zoomLabel = null, selLabel = null, fileNav = null;

export function initStatusbar() {
  bar = document.getElementById('statusbar');
  clear(bar).append(
    (fileNav = el('div.filenav', { style: 'display:none;align-items:center;gap:4px' })),
    (pageLabel = el('span', { text: '' })),
    (selLabel = el('span', { text: '', style: 'color:var(--fg-faint)' })),
    el('span.spacer'),
    el('div.zoom', {}, [
      el('button', { title: 'Zoom out', 'aria-label': 'Zoom out', html: icon('zoomout'), onClick: () => zoomBy(1 / 1.2) }),
      (zoomLabel = el('button', { title: 'Fit width', 'aria-label': 'Fit width', text: '100%', onClick: () => setFitMode('width') })),
      el('button', { title: 'Zoom in', 'aria-label': 'Zoom in', html: icon('zoomin'), onClick: () => zoomBy(1.2) }),
    ]),
  );
  on('rendoc:ready', update);
  on('rendoc:cleared', update);
  on('page:current', update);
  on('view:changed', update);
  on('viewer:rendered', update);
  on('selection:count', ({ count }) => { if (selLabel) selLabel.textContent = count ? ` · ${count} selected` : ''; });
  on('folder:changed', renderFileNav);
  on('file:changed', renderFileNav);
  on('doc:closed', renderFileNav);
  update();
}

// The folder-mode file stepper: ◀ filename.pdf (i / N) ▶. Hidden outside folder mode.
function renderFileNav() {
  if (!fileNav) return;
  const files = state.session.files;
  if (!files || files.length < 2) { fileNav.style.display = 'none'; clear(fileNav); return; }
  const i = state.session.currentIndex, n = files.length;
  fileNav.style.display = 'flex';
  clear(fileNav).append(
    el('button', { title: 'Previous PDF', 'aria-label': 'Previous PDF', html: icon('undo'), disabled: i <= 0, onClick: () => prevFile() }),
    el('span', { text: `${state.session.fileName || ''} (${i + 1}/${n})`, style: 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
    el('button', { title: 'Next PDF', 'aria-label': 'Next PDF', html: icon('redo'), disabled: i >= n - 1, onClick: () => nextFile() }),
    el('span', { text: '·', style: 'color:var(--fg-faint);margin:0 4px' }),
  );
}

function update() {
  if (!bar) return;
  const n = state.doc ? state.doc.pageCount() : 0;
  pageLabel.textContent = n ? `Page ${Math.min(state.view.pageIndex + 1, n)} of ${n}` : 'No document';
  if (zoomLabel) zoomLabel.textContent = n ? `${currentScalePct()}%` : '—';
}
