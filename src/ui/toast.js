// toast.js — transient notifications + the global error net. Errors are LOUD and
// recoverable (handoff §8): an exception anywhere surfaces here instead of dying
// silently. The reporter itself must never throw.

import { el } from './dom.js';
import { on } from '../core/events.js';

let _root = null;
function root() { return _root || (_root = document.getElementById('toasts')); }

export function toast(message, level = 'ok', { detail = '', duration = 3200 } = {}) {
  try {
    const node = el('div.toast', { class: `toast ${level}`, role: 'status' }, [
      el('span', { text: message }),
      detail ? el('span.detail', { text: detail }) : null,
    ]);
    root().append(node);
    if (duration) setTimeout(() => { node.style.opacity = '0'; setTimeout(() => node.remove(), 200); }, duration);
    return node;
  } catch { /* a failing reporter must not cascade */ return null; }
}

// Global error surface — the highest-leverage net in any browser app. Wired once.
let _last = 0;
export function installErrorNet() {
  const surface = (kind, e) => {
    try {
      console.error(`[${kind}]`, e);
      const now = Date.now();
      if (now - _last < 1500) return; // throttle bursts
      _last = now;
      const msg = (e && (e.message || e.reason?.message)) || String(e);
      toast('Something went wrong', 'err', { detail: `${msg} (see console)`, duration: 6000 });
    } catch {}
  };
  addEventListener('error', (e) => { if (e.error || e.message) surface('uncaught', e.error || e.message); });
  addEventListener('unhandledrejection', (e) => surface('rejection', e.reason || e));
  // App-emitted errors route here too.
  on('error', (d) => toast(d?.message || 'Error', 'err', { detail: d?.detail || '', duration: 6000 }));
  on('toast', (d) => toast(d?.message || '', d?.level || 'ok', { detail: d?.detail, duration: d?.duration }));
}
