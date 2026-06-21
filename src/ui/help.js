// help.js — the `?` panel. What Sheaf is, the keyboard grammar (read from the
// registered grammar so it never drifts from reality), and the privacy posture.

import { el } from './dom.js';
import { openModal } from './modal.js';
import { keyboard } from '../core/keyboard.js';

export function openHelp() {
  const content = () => el('div', { style: 'display:flex;flex-direction:column;gap:14px' }, [
    el('p', { html: '<b>Sheaf</b> is a browser-native PDF editor. Your document is opened straight off your disk, edited entirely in this tab, and saved back — <b>nothing is uploaded</b>. Merge, reorder, rotate, delete pages, edit metadata, and more.' }),
    el('div', {}, [
      el('div', { text: 'Keyboard', style: 'font-size:13px;color:var(--fg-muted);margin-bottom:6px' }),
      el('div', { style: 'display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px' },
        shortcutRows().flatMap(([k, d]) => [
          el('kbd', { text: k, style: 'font-family:var(--mono);background:var(--bg-sunken);padding:2px 7px;border-radius:5px;justify-self:start' }),
          el('span', { text: d, style: 'color:var(--fg-muted)' }),
        ])),
    ]),
    el('p', { style: 'font-size:12px;color:var(--fg-faint)', html: 'Tip: select pages in the left rail (click, ⇧-click for a range, ⌘/Ctrl-click to add) — page operations act on the selection. Drag a thumbnail to reorder.' }),
  ]);
  return openModal({ title: 'Help', content, actions: [{ label: 'Close', kind: 'primary', value: true }] });
}

// Prefer the live grammar; fall back to a static list if nothing registered yet.
function shortcutRows() {
  const live = keyboard.list().filter(b => b.label).map(b => [prettyCombo(b.combo), b.label]);
  if (live.length) return live;
  return [
    ['⌘O', 'Open'], ['⌘S', 'Save'], ['⌘⇧S', 'Save as'],
    ['⌘Z', 'Undo'], ['⌘⇧Z', 'Redo'],
    ['+ / -', 'Zoom in / out'], ['0', 'Fit width'],
    ['?', 'Help'], ['Esc', 'Close dialog'],
  ];
}

function prettyCombo(combo) {
  const mac = navigator.platform.toLowerCase().includes('mac');
  return combo.split('+').map(p => ({
    mod: mac ? '⌘' : 'Ctrl', shift: '⇧', alt: mac ? '⌥' : 'Alt',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc',
  }[p] || p.toUpperCase())).join(mac ? '' : '+');
}
