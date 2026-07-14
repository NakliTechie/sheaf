// findbar.js — in-document text search (mod+f). Searches the PDF.js text layer
// (same geometry math as spanedit), shows "n of m", cycles with Enter/Shift+Enter
// or the ‹ › buttons, and flashes a highlight over the current match. The index is
// derived from the render doc and invalidated on any document change; a query only
// ever reads text runs — search never mutates the document.

import { el } from './dom.js';
import { state } from '../core/state.js';
import { on } from '../core/events.js';
import { currentRenderDoc } from './rendoc.js';
import { scrollToPage } from './viewer.js';

let bar = null, input = null, countEl = null, hitEl = null;
let index = null;        // [{ page, str, x, y, w, h }] — normalized text runs
let indexFor = null;     // the render doc the index was built from
let matches = [];        // [{ page, x, y, w, h }] — normalized sub-run boxes
let cur = -1;
let qtoken = 0;          // supersedes in-flight queries (buildIndex awaits mid-run)

export function initFindbar() {
  bar = el('div', { id: 'findbar', role: 'search', 'aria-label': 'Find in document' }, [
    (input = el('input', { type: 'text', placeholder: 'Find in document…', 'aria-label': 'Find text' })),
    (countEl = el('span', { class: 'count', text: '' })),
    el('button', { class: 'btn icon', title: 'Previous match', 'aria-label': 'Previous match', onClick: () => step(-1) }, ['‹']),
    el('button', { class: 'btn icon', title: 'Next match', 'aria-label': 'Next match', onClick: () => step(1) }, ['›']),
    el('button', { class: 'btn icon', title: 'Close (Esc)', 'aria-label': 'Close find', onClick: closeFindbar }, ['×']),
  ]);
  bar.classList.add('hidden');
  document.getElementById('body').append(bar);

  let debounce;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => runQuery(true), 160); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeFindbar(); }
    else if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  });

  // Any mutation invalidates the index (text may have moved). Re-query on
  // rendoc:ready, not doc:changed — the new render doc only exists once the
  // re-derive lands; at doc:changed time currentRenderDoc() is still the old one.
  on('rendoc:ready', () => { index = null; if (isOpen() && input.value) runQuery(false); });
  on('doc:closed', closeFindbar);
}

function isOpen() { return bar && !bar.classList.contains('hidden'); }

export function openFindbar() {
  if (!state.doc) return;
  bar.classList.remove('hidden');
  input.focus();
  input.select();
}

export function closeFindbar() {
  if (!bar) return;
  bar.classList.add('hidden');
  clearHit();
  matches = []; cur = -1;
  countEl.textContent = '';
}

// ── index: one pass over the text layer, normalized page-relative geometry ──────
async function buildIndex() {
  const pdf = currentRenderDoc();
  if (!pdf) return [];
  if (index && indexFor === pdf) return index;
  const runs = [];
  for (let p = 0; p < pdf.numPages; p += 1) {
    const page = await pdf.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    const W = vp.width, H = vp.height;
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, b, , d, e, f] = it.transform;
      const h = it.height || Math.hypot(b, d) || 10;
      const w = it.width || 0;
      runs.push({ page: p, str: it.str, x: e / W, y: (H - (f + h)) / H, w: w / W, h: h / H });
    }
  }
  index = runs;
  indexFor = pdf;
  return runs;
}

async function runQuery(resetToFirst) {
  const my = ++qtoken;
  const q = input.value.trim().toLowerCase();
  clearHit();
  matches = []; cur = -1;
  if (!q) { countEl.textContent = ''; return; }
  const runs = await buildIndex();
  if (my !== qtoken) return; // a newer query took over while the index built
  for (const r of runs) {
    const hay = r.str.toLowerCase();
    let i = hay.indexOf(q);
    while (i !== -1) {
      // Sub-run box by character proportion — approximate, fine for a flash highlight.
      matches.push({ page: r.page, x: r.x + (i / r.str.length) * r.w, y: r.y, w: Math.max((q.length / r.str.length) * r.w, 0.004), h: r.h });
      i = hay.indexOf(q, i + 1);
    }
  }
  if (!matches.length) { countEl.textContent = '0 matches'; return; }
  cur = resetToFirst || cur < 0 ? 0 : Math.min(cur, matches.length - 1);
  showCurrent();
}

function step(dir) {
  if (!matches.length) { runQuery(true); return; }
  cur = (cur + dir + matches.length) % matches.length;
  showCurrent();
}

function showCurrent() {
  const m = matches[cur];
  countEl.textContent = `${cur + 1} of ${matches.length}`;
  scrollToPage(m.page);
  clearHit();
  const wrap = document.querySelector(`.page-wrap[data-page="${m.page}"]`);
  if (!wrap) return;
  hitEl = el('div', { class: 'find-hit' });
  const pad = 0.004; // a breath of padding so the box doesn't shave the glyphs
  hitEl.style.left = `${(m.x - pad) * 100}%`;
  hitEl.style.top = `${(m.y - pad) * 100}%`;
  hitEl.style.width = `${(m.w + pad * 2) * 100}%`;
  hitEl.style.height = `${(m.h + pad * 2) * 100}%`;
  wrap.append(hitEl);
}

function clearHit() { if (hitEl) { hitEl.remove(); hitEl = null; } }
