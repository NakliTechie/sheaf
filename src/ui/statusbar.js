// statusbar.js — page position + zoom. Compact, bottom of the shell.

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { on } from '../core/events.js';
import { zoomBy, setFitMode, currentScalePct } from './viewer.js';

let bar = null, pageLabel = null, zoomLabel = null, selLabel = null;

export function initStatusbar() {
  bar = document.getElementById('statusbar');
  clear(bar).append(
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
  update();
}

function update() {
  if (!bar) return;
  const n = state.doc ? state.doc.pageCount() : 0;
  pageLabel.textContent = n ? `Page ${Math.min(state.view.pageIndex + 1, n)} of ${n}` : 'No document';
  if (zoomLabel) zoomLabel.textContent = n ? `${currentScalePct()}%` : '—';
}
