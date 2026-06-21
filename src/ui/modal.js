// modal.js — in-app prompt/confirm/forms (never native dialogs, handoff §8).
// Focus is trapped on open and restored on close; Esc cancels; the scrim cancels.

import { el, clear } from './dom.js';
import { emit } from '../core/events.js';

let _root = null;
function root() { return _root || (_root = document.getElementById('modal-root')); }

// Low-level: render a modal, resolve with `result` when closed.
export function openModal({ title, content, actions = [], dismissable = true, onMount } = {}) {
  return new Promise((resolve) => {
    const r = root();
    const prevFocus = document.activeElement;
    const close = (value) => {
      r.classList.remove('open'); clear(r);
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      emit('modal:close', null);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); close(null); }
      if (e.key === 'Tab') trapTab(e, modal);
    };

    const foot = el('div.foot', {}, actions.map(a =>
      el('button', {
        class: `btn ${a.kind === 'primary' ? 'primary' : ''} ${a.kind === 'danger' ? 'danger' : ''}`,
        onClick: () => { const v = typeof a.value === 'function' ? a.value() : a.value; if (v !== undefined) close(v); },
      }, [a.label])
    ));

    const bodyNode = typeof content === 'function' ? content({ close }) : content;
    const modal = el('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' }, [
      title ? el('h2', { text: title }) : null,
      el('div.body', {}, [bodyNode]),
      actions.length ? foot : null,
    ]);

    clear(r).append(el('div.scrim', { onClick: () => dismissable && close(null) }), modal);
    r.classList.add('open');
    emit('modal:open', null);
    document.addEventListener('keydown', onKey, true);
    onMount?.({ close, modal });
    const first = modal.querySelector('input, select, textarea, button.primary, button');
    first?.focus();
  });
}

function trapTab(e, container) {
  const f = [...container.querySelectorAll('button, input, select, textarea, [tabindex]')].filter(n => !n.disabled && n.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function confirmModal(message, { title = 'Confirm', okLabel = 'OK', danger = false } = {}) {
  return openModal({
    title,
    content: el('p', { text: message }),
    actions: [
      { label: 'Cancel', value: false },
      { label: okLabel, kind: danger ? 'danger' : 'primary', value: true },
    ],
  });
}

// fields: [{ name, label, type='text', value, options:[{value,label}], min, max, placeholder }]
export function formModal(title, fields, { okLabel = 'Save' } = {}) {
  const inputs = {};
  const content = () => {
    const body = el('div', {}, fields.map(f => {
      let input;
      if (f.type === 'select') {
        input = el('select', {}, (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value }, [o.label])));
      } else {
        input = el('input', { type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', min: f.min, max: f.max });
      }
      inputs[f.name] = input;
      return el('label', {}, [f.label, input]);
    }));
    return body;
  };
  return openModal({
    title, content,
    actions: [
      { label: 'Cancel', value: null },
      { label: okLabel, kind: 'primary', value: () => {
        const out = {};
        for (const f of fields) { const v = inputs[f.name].value; out[f.name] = f.type === 'number' ? Number(v) : v; }
        return out;
      } },
    ],
  });
}
