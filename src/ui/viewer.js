// viewer.js — the page surface. Renders the current render-doc's pages continuously
// into #viewport, tracks the visible page, and owns zoom / fit. Re-renders on
// rendoc:ready (document changed) and on view changes.
//
// M1 renders every page at the computed scale. Virtualized rendering (render only
// near-viewport pages) is a known later optimization; flagged, not silently capped.

import { el, clear } from './dom.js';
import { state } from '../core/state.js';
import { on, emit } from '../core/events.js';
import { renderPage } from '../core/render.js';
import { currentRenderDoc } from './rendoc.js';

const PAD = 16;
const MAX_FIT_WIDTH = 1100; // px — fit-width never renders a page wider than this
let viewport = null;
let renderToken = 0;
let lastRenderWidth = 0;

export function initViewer() {
  viewport = document.getElementById('viewport');
  on('rendoc:ready', () => renderAll());
  on('rendoc:cleared', () => { clear(viewport); lastRenderWidth = 0; });
  on('view:changed', () => renderAll());
  viewport.addEventListener('scroll', trackCurrentPage, { passive: true });

  // Re-render when the viewport's WIDTH actually changes. This is what makes the
  // initial render correct: #body is un-hidden on open, so the viewport's width only
  // settles a frame or two after rendoc:ready fires — an early renderAll would size
  // pages to a near-zero width. The observer catches the settle (and later sidebar /
  // window changes) and re-renders fit-width/page at the real width.
  let rT;
  const ro = new ResizeObserver(() => {
    const w = viewport.clientWidth;
    if (Math.abs(w - lastRenderWidth) < 4) return;        // width unchanged — ignore
    if (state.view.fitMode !== 'width' && state.view.fitMode !== 'page') { lastRenderWidth = w; return; }
    clearTimeout(rT);
    rT = setTimeout(() => { if (state.doc) renderAll(); }, 80);
  });
  ro.observe(viewport);
}

function scaleForPage(p) {
  const avail = viewport.clientWidth - PAD * 2;
  const availH = viewport.clientHeight - PAD * 2;
  switch (state.view.fitMode) {
    // Cap fit-width so a small page doesn't balloon to absurd zoom on a wide monitor
    // (a 420pt page on a 2000px viewport would otherwise be ~450%). Pages stay centered.
    case 'width':  return Math.max(0.1, Math.min(avail, MAX_FIT_WIDTH) / p.width);
    case 'page':   return Math.max(0.1, Math.min(avail / p.width, availH / p.height));
    case 'actual': return 1.0;
    default:       return state.view.zoom; // 'custom'
  }
}

async function renderAll() {
  const pdf = currentRenderDoc();
  if (!pdf || !state.doc) return;
  // Don't render fit-width/page at an implausibly small width (the viewport may not
  // be laid out yet, or the window is momentarily tiny). Leave whatever's shown and
  // wait — the ResizeObserver re-renders once the width is real.
  const fitsWidth = state.view.fitMode === 'width' || state.view.fitMode === 'page';
  if (fitsWidth && viewport.clientWidth < 120) return;
  const my = ++renderToken;
  lastRenderWidth = viewport.clientWidth;
  const pages = state.doc.pages();
  clear(viewport);

  // Build every page's wrap synchronously so the viewport's shape + page count are
  // honest immediately (dim-never-hide); then render concurrently. One slow or stuck
  // page can't block the rest, and the thumbnail rail derives from these canvases
  // (page:painted) rather than rendering the same page proxy a second time.
  const slots = pages.map((p) => {
    const canvas = el('canvas', { 'aria-label': `Page ${p.index + 1}` });
    const wrap = el('div.page-wrap', { dataset: { page: String(p.index) } }, [canvas, el('div.badge', { text: `${p.index + 1}` })]);
    viewport.append(wrap);
    return { p, canvas, wrap };
  });

  await Promise.all(slots.map(async ({ p, canvas, wrap }) => {
    if (my !== renderToken) return;
    try {
      const r = await renderPage(pdf, p.index, scaleForPage(p), canvas);
      if (my !== renderToken) return;
      if (r?.timedOut) wrap.append(el('div.badge', { text: 'still rendering…', style: 'top:auto;bottom:6px;left:6px' }));
      emit('page:painted', { index: p.index, canvas, width: r.width, height: r.height });
    } catch {
      if (my === renderToken) wrap.append(el('div.badge', { text: 'render failed', style: 'top:auto;bottom:6px;left:6px;color:var(--danger)' }));
    }
  }));
  if (my === renderToken) emit('viewer:rendered', { pageCount: pages.length });
}

function trackCurrentPage() {
  if (!viewport) return;
  const mid = viewport.scrollTop + viewport.clientHeight / 2;
  let best = 0, bestDist = Infinity;
  for (const wrap of viewport.querySelectorAll('.page-wrap')) {
    const center = wrap.offsetTop + wrap.offsetHeight / 2;
    const d = Math.abs(center - mid);
    if (d < bestDist) { bestDist = d; best = Number(wrap.dataset.page); }
  }
  if (best !== state.view.pageIndex) { state.view.pageIndex = best; emit('page:current', { index: best }); }
}

export function setFitMode(mode) {
  state.view.fitMode = mode;
  if (mode !== 'custom') emit('prefs:save', null);
  emit('view:changed', null);
}

export function zoomBy(factor) {
  const base = state.view.fitMode === 'custom' ? state.view.zoom : effectiveCurrentScale();
  state.view.zoom = Math.max(0.1, Math.min(8, base * factor));
  state.view.fitMode = 'custom';
  emit('view:changed', null);
}

function effectiveCurrentScale() {
  const pages = state.doc?.pages();
  if (!pages?.length) return 1;
  return scaleForPage(pages[state.view.pageIndex] || pages[0]);
}

export function currentScalePct() { return Math.round(effectiveCurrentScale() * 100); }

export function scrollToPage(index) {
  const wrap = viewport.querySelector(`.page-wrap[data-page="${index}"]`);
  wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
