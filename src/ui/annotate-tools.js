// annotate-tools.js — the interactive annotation layer. When a tool is active, a
// pointer gesture on a page becomes normalized (0..1) coordinates and dispatches an
// annotate.* op through the one runner. A live preview overlay shows the shape mid-
// gesture; the committed draw comes back through the normal render path.

import { state } from '../core/state.js';
import { on, emit } from '../core/events.js';
import { dispatch } from '../core/runner.js';
import { el } from './dom.js';
import { formModal } from './modal.js';
import { chooseSignature } from './signature.js';

const DRAG_TOOLS = new Set(['highlight', 'rect', 'line', 'pencil', 'whiteout', 'redact']);
const ALL_TOOLS = new Set([...DRAG_TOOLS, 'text', 'sign']);

export const toolSettings = { color: '#ff3b30', highlightColor: '#ffe14d', thickness: 2 };

let viewport = null;
let active = null;
let gesture = null;
let preview = null;

export function currentTool() { return active; }

export function setTool(tool) {
  active = ALL_TOOLS.has(tool) ? tool : null;
  state.activeTool = active;
  viewport.classList.toggle('tool-active', !!active);
  emit('tool:changed', { tool: active });
}

export function initAnnotateTools() {
  viewport = document.getElementById('viewport');
  viewport.addEventListener('pointerdown', onDown);
  // A fresh document clears the active tool.
  on('doc:loaded', () => setTool(null));
}

function wrapUnder(target) { return target?.closest?.('.page-wrap'); }

function normalize(rect, clientX, clientY) {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

async function onDown(e) {
  if (!active) return;
  const wrap = wrapUnder(e.target);
  if (!wrap) return;
  const canvas = wrap.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  const page = Number(wrap.dataset.page);

  if (active === 'text') {
    const at = normalize(rect, e.clientX, e.clientY);
    const v = await formModal('Text box', [
      { name: 'text', label: 'Text', value: '' },
      { name: 'fontSize', label: 'Size (pt)', type: 'number', value: 14 },
    ]);
    if (v?.text) dispatch('annotate.textbox', { page, x: at.x, y: at.y, text: v.text, fontSize: v.fontSize, color: toolSettings.color });
    return;
  }

  if (active === 'sign') {
    const at = normalize(rect, e.clientX, e.clientY);
    const sig = await chooseSignature();
    if (!sig) return;
    if (sig.kind === 'text') dispatch('sign.place', { page, x: at.x, y: at.y, name: sig.name, dateText: sig.dateText, color: toolSettings.color });
    else dispatch('sign.image', { page, x: at.x, y: at.y, width: 0.28, imageBytes: sig.bytes });
    return;
  }

  e.preventDefault();
  const start = normalize(rect, e.clientX, e.clientY);
  gesture = { wrap, page, rect, start, cur: null, points: [start] };
  preview = el('div', { class: 'annot-preview' });
  wrap.style.position = 'relative';
  wrap.appendChild(preview);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function onMove(e) {
  if (!gesture) return;
  gesture.cur = normalize(gesture.rect, e.clientX, e.clientY);
  gesture.points.push(gesture.cur);
  drawPreview();
}

function drawPreview() {
  const { start, cur, points } = gesture;
  if (active === 'pencil') {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(' ');
    preview.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%"><path d="${d}" fill="none" stroke="${toolSettings.color}" stroke-width="0.4"/></svg>`;
    return;
  }
  if (!cur) return;
  if (active === 'highlight' || active === 'rect' || active === 'whiteout' || active === 'redact') {
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    const style = active === 'highlight' ? `background:${toolSettings.highlightColor};opacity:.4`
      : active === 'whiteout' ? `background:#fff;border:1px dashed #999`
      : active === 'redact' ? `background:#000`
      : `border:2px solid ${toolSettings.color}`;
    preview.innerHTML = `<div style="position:absolute;left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;${style}"></div>`;
  } else if (active === 'line') {
    preview.innerHTML = `<svg style="position:absolute;inset:0;width:100%;height:100%"><line x1="${start.x * 100}%" y1="${start.y * 100}%" x2="${cur.x * 100}%" y2="${cur.y * 100}%" stroke="${toolSettings.color}" stroke-width="2"/></svg>`;
  }
}

function onUp() {
  window.removeEventListener('pointermove', onMove);
  if (!gesture) return;
  const g = gesture; gesture = null;
  if (preview) { preview.remove(); preview = null; }
  const { start, cur, points, page } = g;

  if (active === 'highlight' || active === 'rect') {
    if (!cur) return;
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    if (w < 0.005 || h < 0.005) return; // ignore stray clicks
    if (active === 'highlight') dispatch('annotate.highlight', { page, x, y, w, h, color: toolSettings.highlightColor });
    else dispatch('annotate.rect', { page, x, y, w, h, color: toolSettings.color, thickness: toolSettings.thickness });
  } else if (active === 'line') {
    if (!cur) return;
    dispatch('annotate.line', { page, x1: start.x, y1: start.y, x2: cur.x, y2: cur.y, color: toolSettings.color, thickness: toolSettings.thickness });
  } else if (active === 'pencil') {
    if (points.length >= 2) dispatch('annotate.pencil', { page, points, color: toolSettings.color, thickness: toolSettings.thickness });
  } else if (active === 'whiteout') {
    if (!cur) return;
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    if (w < 0.005 || h < 0.005) return;
    whiteoutRegion(page, x, y, w, h);
  } else if (active === 'redact') {
    if (!cur) return;
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    if (w < 0.005 || h < 0.005) return;
    dispatch('redact.region', { page, x, y, w, h }); // true removal + black box
  }
}

async function whiteoutRegion(page, x, y, w, h) {
  const v = await formModal('Whiteout & retype', [
    { name: 'text', label: 'Replacement text (optional)', value: '' },
    { name: 'fontSize', label: 'Size (pt)', type: 'number', value: 12 },
  ]);
  if (v) dispatch('text.whiteout', { page, x, y, w, h, text: v.text || '', fontSize: v.fontSize, textColor: toolSettings.color });
}
