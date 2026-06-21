// ocr-menu.js — OCR entry point. Make a scan searchable (invisible text layer) or
// extract its text. Runs 100% locally (vendored engine, no download, no upload) — a
// progress bar reflects the real Tesseract status. Heavy compute, so it's confirmed
// and shows progress.

import { el, clear } from './dom.js';
import { openModal, confirmModal } from './modal.js';
import { state } from '../core/state.js';
import { on, off } from '../core/events.js';
import { dispatch } from '../core/runner.js';
import { terminateOcr } from '../core/ocr.js';
import { toast } from './toast.js';

export function openOcrMenu() {
  if (!state.doc) return;
  const n = state.doc.pageCount();
  let close;
  const item = (label, desc, fn) => el('button', {
    class: 'btn', style: 'justify-content:flex-start;width:100%;text-align:left;height:auto;padding:10px 12px;flex-direction:column;align-items:flex-start;gap:2px',
    onClick: async () => { close(); await fn(); },
  }, [el('span', { text: label, style: 'font-size:14px' }), el('span', { text: desc, style: 'font-size:12px;color:var(--fg-faint)' })]);

  const content = ({ close: c }) => { close = c; return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    el('div', { html: `Recognizes text on scanned pages — <b>entirely on this device</b>, no upload, no download (the engine is built in).`, style: 'font-size:12px;color:var(--fg-muted);padding:2px 4px 6px' }),
    item('Make searchable', `Add an invisible text layer to all ${n} page${n > 1 ? 's' : ''} — the page looks the same but becomes searchable`, () => runOcr('ocr.searchable')),
    item('Extract text from scan', 'Recognize and download the text as a .txt file', () => runOcr('ocr.extract')),
  ]); };
  return openModal({ title: 'OCR', content, actions: [{ label: 'Close', value: true }] });
}

async function runOcr(opId) {
  const n = state.doc.pageCount();
  if (!await confirmModal(`Run OCR on ${n} page${n > 1 ? 's' : ''}? This runs locally and can take a few seconds per page the first time (the engine warms up).`, { title: 'OCR', okLabel: 'Run OCR' })) return;

  const { overlay, setProgress } = progressOverlay();
  const onProg = (m) => setProgress(m.status, m.progress);
  on('ocr:progress', onProg);
  try {
    const res = await dispatch(opId, {}, { source: 'ui' });
    if (opId === 'ocr.extract') {
      const text = res.artifact?.text || '';
      if (!text.trim()) toast('No text recognized', 'warn');
      else { downloadText(text); toast('Text extracted', 'ok'); }
    } else {
      toast('Pages are now searchable', 'ok');
    }
  } catch (e) {
    toast('OCR failed', 'err', { detail: e.message });
  } finally {
    off('ocr:progress', onProg);
    overlay.remove();
    terminateOcr().catch(() => {}); // free the worker + wasm
  }
}

function progressOverlay() {
  const label = el('div', { text: 'Starting OCR…', style: 'font-size:13px;margin-bottom:8px' });
  const bar = el('div', { style: 'height:6px;border-radius:4px;background:var(--accent);width:0%;transition:width .2s' });
  const overlay = el('div', { style: 'position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;background:var(--overlay)' }, [
    el('div', { style: 'background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:20px 24px;min-width:300px;box-shadow:var(--shadow-pop)' }, [
      label, el('div', { style: 'height:6px;border-radius:4px;background:var(--bg-sunken);overflow:hidden' }, [bar]),
    ]),
  ]);
  document.body.appendChild(overlay);
  return { overlay, setProgress: (status, p) => { label.textContent = status ? status[0].toUpperCase() + status.slice(1) + '…' : 'Working…'; if (typeof p === 'number') bar.style.width = `${Math.round(p * 100)}%`; } };
}

function downloadText(text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: (state.session.fileName || 'document').replace(/\.pdf$/i, '') + '-ocr.txt' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
