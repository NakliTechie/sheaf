// signature.js — the signature chooser. Type it, draw it, upload an image, or pick a
// saved one. Drawn/uploaded signatures can be saved to a local library (IndexedDB —
// the storage façade's signature store). Returns the chosen signature; the sign tool
// places it. Resolves null on cancel.
//
//   { kind: 'text',  name, dateText }
//   { kind: 'image', bytes }

import { el, clear } from './dom.js';
import { openModal } from './modal.js';
import * as storage from '../core/storage.js';
import { toast } from './toast.js';

export function chooseSignature() {
  return openModal({ title: 'Signature', dismissable: true, content: build });
}

function build({ close }) {
  const root = el('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:420px' });
  const tabs = el('div', { style: 'display:flex;gap:4px' });
  const panel = el('div');
  let active = 'type';

  const setTab = (name) => {
    active = name;
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === name);
    clear(panel).append(PANELS[name](close));
  };
  for (const [name, label] of [['type', 'Type'], ['draw', 'Draw'], ['upload', 'Upload'], ['saved', 'Saved']]) {
    tabs.append(el('button', { class: 'btn tool', dataset: { tab: name }, text: label, onClick: () => setTab(name) }));
  }
  root.append(tabs, panel);
  setTab('type');
  return root;
}

const PANELS = {
  type(close) {
    const name = el('input', { type: 'text', placeholder: 'Your name', style: 'width:100%' });
    const withDate = el('input', { type: 'checkbox', checked: true, style: 'width:16px;height:16px' });
    return el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
      el('label', {}, ['Signature', name]),
      el('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, [withDate, 'Include today’s date']),
      el('div', { style: 'display:flex;justify-content:flex-end' }, [
        el('button', { class: 'btn primary', onClick: () => { if (name.value.trim()) close({ kind: 'text', name: name.value.trim(), dateText: withDate.checked ? new Date().toLocaleDateString() : '' }); } }, ['Use']),
      ]),
    ]);
  },

  draw(close) {
    const canvas = el('canvas', { width: 560, height: 180, style: 'width:100%;height:180px;background:var(--bg-sunken);border:1px solid var(--panel-border);border-radius:8px;touch-action:none;cursor:crosshair' });
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let drawing = false, last = null, dirty = false;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; });
    canvas.addEventListener('pointerup', () => { drawing = false; });
    const save = el('input', { type: 'checkbox', style: 'width:16px;height:16px' });
    return el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
      canvas,
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
        el('label', { style: 'flex-direction:row;align-items:center;gap:8px;font-size:13px' }, [save, 'Save to library']),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('button', { class: 'btn', onClick: () => ctx.clearRect(0, 0, canvas.width, canvas.height) }, ['Clear']),
          el('button', { class: 'btn primary', onClick: async () => { if (!dirty) return toast('Draw a signature first', 'warn'); const bytes = await canvasPng(canvas); if (save.checked) await persist(bytes); close({ kind: 'image', bytes }); } }, ['Use']),
        ]),
      ]),
    ]);
  },

  upload(close) {
    const input = el('input', { type: 'file', accept: 'image/png,image/jpeg' });
    const save = el('input', { type: 'checkbox', style: 'width:16px;height:16px' });
    return el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
      el('p', { text: 'Choose a PNG or JPEG of your signature (a transparent PNG looks best).', style: 'font-size:13px;color:var(--fg-muted)' }),
      input,
      el('label', { style: 'flex-direction:row;align-items:center;gap:8px;font-size:13px' }, [save, 'Save to library']),
      el('div', { style: 'display:flex;justify-content:flex-end' }, [
        el('button', { class: 'btn primary', onClick: async () => { const f = input.files?.[0]; if (!f) return toast('Pick an image', 'warn'); const bytes = new Uint8Array(await f.arrayBuffer()); if (save.checked) await persist(bytes); close({ kind: 'image', bytes }); } }, ['Use']),
      ]),
    ]);
  },

  saved(close) {
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;min-height:60px' });
    const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [grid]);
    storage.listSignatures().then((sigs) => {
      if (!sigs.length) { grid.append(el('div', { text: 'No saved signatures yet — draw or upload one and tick “Save to library”.', style: 'grid-column:1/-1;font-size:13px;color:var(--fg-faint)' })); return; }
      for (const s of sigs) {
        const url = URL.createObjectURL(new Blob([s.bytes], { type: 'image/png' }));
        const cell = el('div', { style: 'position:relative;border:1px solid var(--panel-border);border-radius:6px;padding:4px;cursor:pointer;background:#fff', onClick: () => close({ kind: 'image', bytes: s.bytes }) }, [
          el('img', { src: url, style: 'width:100%;height:48px;object-fit:contain' }),
        ]);
        cell.append(el('button', { class: 'btn danger', style: 'position:absolute;top:2px;right:2px;padding:0 5px;height:18px;font-size:11px', title: 'Delete', onClick: async (e) => { e.stopPropagation(); await storage.deleteSignature(s.id); cell.remove(); } }, ['×']));
        grid.append(cell);
      }
    }).catch(() => {});
    return wrap;
  },
};

async function canvasPng(canvas) {
  const url = canvas.toDataURL('image/png');
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function persist(bytes) {
  const id = (crypto.randomUUID?.() || `sig-${Date.now()}`);
  try { await storage.saveSignature({ id, kind: 'image', bytes, at: new Date().toISOString() }); toast('Saved to library', 'ok'); }
  catch (e) { toast('Could not save', 'err', { detail: e.message }); }
}
