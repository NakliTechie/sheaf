// marksmenu.js — the Marks menu (watermark, page numbers, Bates, header/footer).
// Each opens a small parameter form, then dispatches through the one runner.

import { el } from './dom.js';
import { openModal, formModal } from './modal.js';
import { dispatch } from '../core/runner.js';

export function openMarksMenu() {
  const item = (label, desc, fn) => el('button', {
    class: 'btn', style: 'justify-content:flex-start;width:100%;text-align:left;height:auto;padding:10px 12px;flex-direction:column;align-items:flex-start;gap:2px',
    onClick: async ({ currentTarget }) => { currentTarget.closest('#modal-root') && close(); await fn(); },
  }, [el('span', { text: label, style: 'font-size:14px' }), el('span', { text: desc, style: 'font-size:12px;color:var(--fg-faint)' })]);

  let close;
  const content = ({ close: c }) => { close = c; return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    item('Watermark', 'Diagonal text across every page', addWatermark),
    item('Page numbers', 'Stamp {n} or {n} / {total}', addPageNumbers),
    item('Bates numbering', 'Sequential prefix + counter (legal)', addBates),
    item('Header / footer', 'Fixed text at a chosen corner', addHeaderFooter),
  ]); };
  return openModal({ title: 'Add marks', content, actions: [{ label: 'Close', value: true }] });
}

async function addWatermark() {
  const v = await formModal('Watermark', [
    { name: 'text', label: 'Text', value: 'CONFIDENTIAL' },
    { name: 'fontSize', label: 'Size', type: 'number', value: 60 },
    { name: 'color', label: 'Colour (hex)', value: '#888888' },
  ]);
  if (v?.text) dispatch('marks.watermark', v);
}

async function addPageNumbers() {
  const v = await formModal('Page numbers', [
    { name: 'format', label: 'Format ({n}, {total})', value: '{n} / {total}' },
    { name: 'position', label: 'Position', type: 'select', value: 'bottom-center',
      options: ['bottom-center', 'bottom-left', 'bottom-right', 'top-center', 'top-left', 'top-right'].map(o => ({ value: o, label: o })) },
    { name: 'startAt', label: 'Start at', type: 'number', value: 1 },
  ]);
  if (v) dispatch('marks.pageNumbers', v);
}

async function addBates() {
  const v = await formModal('Bates numbering', [
    { name: 'prefix', label: 'Prefix', value: 'ABC' },
    { name: 'startAt', label: 'Start at', type: 'number', value: 1 },
    { name: 'digits', label: 'Digits', type: 'number', value: 6 },
  ]);
  if (v) dispatch('marks.bates', v);
}

async function addHeaderFooter() {
  const v = await formModal('Header / footer', [
    { name: 'text', label: 'Text', value: '' },
    { name: 'position', label: 'Position', type: 'select', value: 'top-center',
      options: ['top-center', 'top-left', 'top-right', 'bottom-center', 'bottom-left', 'bottom-right'].map(o => ({ value: o, label: o })) },
  ]);
  if (v?.text) dispatch('marks.text', v);
}
