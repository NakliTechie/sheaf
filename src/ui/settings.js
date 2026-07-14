// settings.js — the settings modal. Theme, default view mode, and the developer
// "agent face" toggle (off by default; this is the only place window.sheaf turns on).
// Plus the honest privacy line and pinned engine versions.

import { el } from './dom.js';
import { openModal } from './modal.js';
import { state, savePrefs } from '../core/state.js';
import { setAgentFace } from '../core/agent.js';
import { setFitMode, setViewMode } from './viewer.js';
import { MANIFEST } from '../core/engines.js';
import { emit } from '../core/events.js';

export function openSettings() {
  const version = document.getElementById('app').dataset.version || '';
  const content = () => el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [
    settingRow('Theme', 'Dark or light. High-contrast dark is the default.',
      select(['dark', 'light'], document.documentElement.getAttribute('data-theme') || 'dark', (v) => {
        document.documentElement.setAttribute('data-theme', v); savePrefs();
        emit('theme:changed', { theme: v });
      })),

    settingRow('Default view', 'How pages stack in the viewport.',
      select(['continuous', 'paginated'], state.view.mode, (v) => setViewMode(v))),

    settingRow('Fit', 'How pages are scaled to the window.',
      select(['width', 'page', 'actual'], state.view.fitMode === 'custom' ? 'width' : state.view.fitMode, (v) => setFitMode(v))),

    el('hr', { style: 'border:none;border-top:1px solid var(--panel-border);margin:2px 0' }),

    settingRow('Agent face', 'Expose window.sheaf + URL mode so scripts and the Bench conductor can drive Sheaf. Off by default — a link can never run ops on your file unless you enable this.',
      toggle(state.dev.agentFace, (v) => { setAgentFace(v); emit('toast', { message: v ? 'Agent face enabled (window.sheaf)' : 'Agent face disabled', level: 'ok' }); })),

    el('div', { style: 'font-size:12px;color:var(--fg-faint);line-height:1.6' }, [
      el('div', { html: '<b style="color:var(--ok)">Private by design.</b> Your PDF never leaves this device. No account, no upload, no telemetry. Nothing is sent anywhere.' }),
      el('div', { style: 'margin-top:6px', text: `Sheaf v${version} · pdf-lib ${MANIFEST['pdf-lib'].version} · pdfjs ${MANIFEST.pdfjs.version} — all engines vendored same-origin and SHA-256 verified.` }),
    ]),
  ]);

  return openModal({ title: 'Settings', content, actions: [{ label: 'Done', kind: 'primary', value: true }] });
}

function settingRow(title, desc, control) {
  return el('div.setting-row', {}, [
    el('div', {}, [el('div', { text: title, style: 'font-size:14px' }), el('div.desc', { text: desc })]),
    el('div', { style: 'flex:0 0 auto' }, [control]),
  ]);
}

function select(options, value, onChange) {
  return el('select', { onChange: (e) => onChange(e.target.value) },
    options.map(o => el('option', { value: o, selected: o === value }, [o[0].toUpperCase() + o.slice(1)])));
}

function toggle(value, onChange) {
  const cb = el('input', { type: 'checkbox', checked: value, onChange: (e) => onChange(e.target.checked), style: 'width:18px;height:18px' });
  return el('label', { style: 'display:inline-flex;align-items:center;gap:6px;cursor:pointer' }, [cb]);
}
