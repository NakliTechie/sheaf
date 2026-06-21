// convertmenu.js — Convert / Export. Text, page images (single or all-as-zip),
// images → PDF, and the lossy compressor. Browser-side ops (render/canvas); each
// downloads or transforms locally.

import { el } from './dom.js';
import { openModal, confirmModal, formModal } from './modal.js';
import { state } from '../core/state.js';
import { dispatch } from '../core/runner.js';
import { makeZip } from '../core/zip.js';
import { downloadBytes } from '../core/storage.js';
import { toast } from './toast.js';

export function openConvertMenu() {
  if (!state.doc) return;
  let close;
  const item = (label, desc, fn) => el('button', {
    class: 'btn', style: 'justify-content:flex-start;width:100%;text-align:left;height:auto;padding:10px 12px;flex-direction:column;align-items:flex-start;gap:2px',
    onClick: async () => { close(); await fn(); },
  }, [el('span', { text: label, style: 'font-size:14px' }), el('span', { text: desc, style: 'font-size:12px;color:var(--fg-faint)' })]);

  const content = ({ close: c }) => { close = c; return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    item('Extract text', 'Download the text layer as .txt', extractText),
    item('Current page → image', 'Download this page as PNG or JPEG', currentPageImage),
    item('All pages → images (zip)', 'Render every page and download a .zip', allPagesZip),
    item('Images → PDF', 'Append PNG/JPEG images as new pages', imagesToPdf),
    el('hr', { style: 'border:none;border-top:1px solid var(--panel-border);margin:4px 0' }),
    item('Compress (flatten to images)', 'Shrink scanned/image PDFs — lossy, text becomes non-selectable', compress),
  ]); };
  return openModal({ title: 'Convert / Export', content, actions: [{ label: 'Close', value: true }] });
}

function baseName() { return (state.session.fileName || 'document').replace(/\.pdf$/i, ''); }

async function extractText() {
  try {
    const res = await dispatch('convert.text', {}, { source: 'ui' });
    const text = res.artifact?.text || '';
    if (!text.trim()) return toast('No extractable text (try OCR for a scan)', 'warn');
    downloadText(text, `${baseName()}.txt`);
    toast('Text extracted', 'ok');
  } catch (e) { toast('Could not extract text', 'err', { detail: e.message }); }
}

async function currentPageImage() {
  const v = await formModal('Page → image', [
    { name: 'format', label: 'Format', type: 'select', value: 'png', options: [{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }] },
  ]);
  if (!v) return;
  try {
    const page = state.view.pageIndex;
    const res = await dispatch('convert.pageImage', { page, format: v.format, scale: 2 }, { source: 'ui' });
    downloadBytesAs(res.artifact.bytes, `${baseName()}-p${page + 1}.${v.format === 'jpeg' ? 'jpg' : 'png'}`, v.format === 'jpeg' ? 'image/jpeg' : 'image/png');
    toast('Page exported', 'ok');
  } catch (e) { toast('Export failed', 'err', { detail: e.message }); }
}

async function allPagesZip() {
  const n = state.doc.pageCount();
  if (!await confirmModal(`Render all ${n} page${n > 1 ? 's' : ''} to PNG and download a zip?`, { title: 'Export all pages', okLabel: 'Export' })) return;
  const note = busy(`Rendering 0/${n}…`);
  try {
    const files = [];
    for (let i = 0; i < n; i++) {
      note.set(`Rendering ${i + 1}/${n}…`);
      const res = await dispatch('convert.pageImage', { page: i, format: 'png', scale: 2 }, { source: 'ui' });
      files.push({ name: `${baseName()}-p${String(i + 1).padStart(3, '0')}.png`, bytes: res.artifact.bytes });
    }
    downloadBytesAs(makeZip(files), `${baseName()}-pages.zip`, 'application/zip');
    toast(`Exported ${n} pages`, 'ok');
  } catch (e) { toast('Export failed', 'err', { detail: e.message }); }
  finally { note.remove(); }
}

function imagesToPdf() {
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg', multiple: 'true' });
  input.onchange = async () => {
    const imgs = [];
    for (const f of input.files || []) imgs.push(new Uint8Array(await f.arrayBuffer()));
    if (!imgs.length) return;
    try { await dispatch('pages.insertImages', { images: imgs, at: -1 }); toast(`Added ${imgs.length} image page${imgs.length > 1 ? 's' : ''}`, 'ok'); }
    catch (e) { toast('Could not insert images', 'err', { detail: e.message }); }
  };
  input.click();
}

async function compress() {
  const v = await formModal('Compress (flatten to images)', [
    { name: 'quality', label: 'JPEG quality (0.1–0.95)', type: 'number', value: 0.6 },
  ]);
  if (!v) return;
  if (!await confirmModal('This rasterizes every page to JPEG — selectable text is flattened away (you can OCR afterward). Continue?', { title: 'Compress', okLabel: 'Compress', danger: true })) return;
  const note = busy('Compressing…');
  try {
    const before = (await state.doc.toBytes()).length;
    await dispatch('compress.rasterize', { quality: Math.max(0.1, Math.min(0.95, v.quality || 0.6)), scale: 1.5 }, { source: 'ui' });
    const after = (await state.doc.toBytes()).length;
    const pct = Math.round((1 - after / before) * 100);
    toast(pct > 0 ? `Compressed ~${pct}% (${kb(before)} → ${kb(after)})` : `Re-encoded (${kb(after)})`, 'ok');
  } catch (e) { toast('Compress failed', 'err', { detail: e.message }); }
  finally { note.remove(); }
}

// ── helpers ──────────────────────────────────────────────────────────────────────
function kb(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
function downloadText(text, name) { downloadAnyBlob(new Blob([text], { type: 'text/plain' }), name); }
function downloadBytesAs(bytes, name, mime) { downloadAnyBlob(new Blob([bytes], { type: mime }), name); }
function downloadAnyBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name }); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
function busy(msg) {
  const label = el('div', { text: msg, style: 'font-size:13px' });
  const ov = el('div', { style: 'position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;background:var(--overlay)' }, [
    el('div', { style: 'background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:18px 24px;box-shadow:var(--shadow-pop)' }, [label]),
  ]);
  document.body.appendChild(ov);
  return { set: (m) => { label.textContent = m; }, remove: () => ov.remove() };
}
