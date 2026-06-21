// formsdialog.js — the Forms panel. Detect the document's AcroForm fields, present
// an input per field, fill them through the runner, and offer to flatten.

import { el } from './dom.js';
import { openModal } from './modal.js';
import { dispatch } from '../core/runner.js';
import { toast } from './toast.js';
import { confirmModal } from './modal.js';

export async function openFormsDialog() {
  let det;
  try { det = (await dispatch('forms.detect', {})).artifact; }
  catch (e) { return toast('Could not read form', 'err', { detail: e.message }); }

  if (!det.fieldCount) {
    return openModal({ title: 'Forms', content: el('p', { text: 'This document has no fillable form fields.' }), actions: [{ label: 'Close', value: true }] });
  }

  const inputs = {};
  const content = ({ close }) => el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, [
    el('div', { text: `${det.fieldCount} field${det.fieldCount > 1 ? 's' : ''}`, style: 'font-size:12px;color:var(--fg-faint)' }),
    ...det.fields.map(f => {
      let input;
      if (f.type === 'checkbox') {
        input = el('select', {}, [el('option', { value: 'false', selected: !f.value }, ['Unchecked']), el('option', { value: 'true', selected: !!f.value }, ['Checked'])]);
      } else if ((f.type === 'dropdown' || f.type === 'optionlist' || f.type === 'radiogroup') && f.options) {
        const sel = Array.isArray(f.value) ? f.value[0] : f.value;
        input = el('select', {}, [el('option', { value: '' }, ['—']), ...f.options.map(o => el('option', { value: o, selected: o === sel }, [o]))]);
      } else {
        input = el('input', { type: 'text', value: Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '') });
      }
      inputs[f.name] = { input, type: f.type };
      return el('label', {}, [el('span', { text: f.name, style: 'font-size:12px;color:var(--fg-muted)' }), input]);
    }),
    el('button', { class: 'btn danger', style: 'align-self:flex-start;font-size:12px', onClick: async () => { close(null); await flatten(); } }, ['Flatten form (make permanent)']),
  ]);

  const result = await openModal({
    title: 'Fill form', content,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Fill', kind: 'primary', value: () => {
        const values = {};
        for (const [name, { input, type }] of Object.entries(inputs)) {
          if (type === 'checkbox') values[name] = input.value === 'true';
          else if (input.value !== '') values[name] = input.value;
        }
        return values;
      } },
    ],
  });
  if (result) {
    try { await dispatch('forms.fill', { values: result }); toast('Form filled', 'ok'); }
    catch (e) { toast('Fill failed', 'err', { detail: e.message }); }
  }
}

async function flatten() {
  if (!await confirmModal('Flatten the form? Field values become permanent page content and the fields are no longer editable.', { title: 'Flatten form', okLabel: 'Flatten', danger: true })) return;
  try { await dispatch('forms.flatten', {}); toast('Form flattened', 'ok'); }
  catch (e) { toast('Flatten failed', 'err', { detail: e.message }); }
}
