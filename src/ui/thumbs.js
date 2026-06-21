// thumbs.js — the page rail. Thumbnails, multi-select (the target set for page ops),
// current-page sync, and drag-to-reorder (dispatches pages.reorder through the one
// runner — the same op the agent face calls).

import { el, clear } from './dom.js';
import { state } from '../core/state.js';
import { on, emit } from '../core/events.js';
import { dispatch } from '../core/runner.js';
import { scrollToPage } from './viewer.js';

const THUMB_W = 140;
let rail = null;
let dragFrom = null;

export function initThumbs() {
  rail = document.getElementById('rail');
  on('rendoc:ready', () => buildSkeleton());
  on('rendoc:cleared', () => clear(rail));
  on('page:painted', ({ index, canvas }) => fillThumb(index, canvas));
  on('page:current', ({ index }) => highlightCurrent(index));
  on('selection:changed', () => paintSelection());
}

export function selectedPages() { return state.selection.pages.slice().sort((a, b) => a - b); }
function setSelection(pages) { state.selection.pages = pages; emit('selection:changed', null); }

// Build the rail skeleton (one thumb per page, correctly sized) immediately from the
// page geometry. Thumbnails are filled by downscaling the viewer's painted canvases
// (page:painted) — Sheaf never renders the same page proxy twice.
function buildSkeleton() {
  if (!state.doc) return;
  const pages = state.doc.pages();
  clear(rail);
  state.selection.pages = state.selection.pages.filter(i => i < pages.length);
  for (const p of pages) {
    const canvas = el('canvas', { width: THUMB_W, height: Math.round(THUMB_W * p.height / p.width) });
    const thumb = el('div.thumb', {
      dataset: { page: String(p.index) },
      role: 'option', 'aria-label': `Page ${p.index + 1}`, tabindex: '0', draggable: 'true',
      onClick: (e) => onThumbClick(e, p.index),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onThumbClick(e, p.index); } },
      onDragstart: (e) => { dragFrom = p.index; e.dataTransfer.effectAllowed = 'move'; },
      onDragover: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
      onDrop: (e) => { e.preventDefault(); onDrop(p.index); },
    }, [canvas, el('div.pno', { text: String(p.index + 1) })]);
    rail.append(thumb);
  }
  paintSelection();
  highlightCurrent(state.view.pageIndex);
}

// Downscale a freshly-painted viewer canvas into the matching thumbnail.
function fillThumb(index, srcCanvas) {
  const thumb = rail?.querySelector(`.thumb[data-page="${index}"] canvas`);
  if (!thumb || !srcCanvas?.width) return;
  try {
    const ctx = thumb.getContext('2d');
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(srcCanvas, 0, 0, thumb.width, thumb.height);
  } catch {}
}

function onThumbClick(e, index) {
  const sel = state.selection.pages;
  if (e.shiftKey && sel.length) {
    const last = sel[sel.length - 1];
    const [a, b] = [Math.min(last, index), Math.max(last, index)];
    const range = []; for (let i = a; i <= b; i++) range.push(i);
    setSelection([...new Set([...sel, ...range])]);
  } else if (e.metaKey || e.ctrlKey) {
    setSelection(sel.includes(index) ? sel.filter(i => i !== index) : [...sel, index]);
  } else {
    setSelection([index]);
    scrollToPage(index);
  }
}

async function onDrop(toIndex) {
  if (dragFrom == null || dragFrom === toIndex) { dragFrom = null; return; }
  const n = state.doc.pageCount();
  const order = [...Array(n).keys()];
  const [moved] = order.splice(dragFrom, 1);
  order.splice(toIndex, 0, moved);
  dragFrom = null;
  await dispatch('pages.reorder', { order }, { source: 'ui' });
  setSelection([toIndex]);
}

function paintSelection() {
  if (!rail) return;
  const sel = new Set(state.selection.pages);
  for (const t of rail.querySelectorAll('.thumb')) t.classList.toggle('selected', sel.has(Number(t.dataset.page)));
  emit('selection:count', { count: sel.size });
}

function highlightCurrent(index) {
  if (!rail) return;
  for (const t of rail.querySelectorAll('.thumb')) t.classList.toggle('current', Number(t.dataset.page) === index);
}
