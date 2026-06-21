// ops/forms.js — AcroForm support (pdf-lib): detect fields, fill them, flatten.
// detect is a content-free artifact (field names/types/values — the conductor and
// the Forms panel read it); fill and flatten mutate the document.

import { getEngine } from '../core/engines.js';

function shortType(t) { return t.replace(/^PDF/, '').replace(/Field$/, '').toLowerCase(); }

function describe(field) {
  const type = field.constructor?.name || 'PDFField';
  const name = field.getName();
  const out = { name, type: shortType(type) };
  try {
    if (type === 'PDFTextField') out.value = field.getText() ?? '';
    else if (type === 'PDFCheckBox') out.value = field.isChecked();
    else if (type === 'PDFDropdown') { out.value = field.getSelected(); out.options = field.getOptions(); }
    else if (type === 'PDFOptionList') { out.value = field.getSelected(); out.options = field.getOptions(); }
    else if (type === 'PDFRadioGroup') { out.value = field.getSelected(); out.options = field.getOptions(); }
  } catch { /* leave value undefined */ }
  return out;
}

export const ops = [
  {
    id: 'forms.detect', label: 'Detect form fields', group: 'forms', icon: 'textbox',
    description: 'List the AcroForm fields (name, type, current value, options). Does not change the document.',
    agentCallable: true, mutates: false,
    params: {},
    run(doc) {
      const form = doc.pdf.getForm();
      const fields = form.getFields().map(describe);
      return { artifact: { fieldCount: fields.length, fields } };
    },
  },

  {
    id: 'forms.fill', label: 'Fill form', group: 'forms', icon: 'textbox',
    description: 'Fill AcroForm fields from a { fieldName: value } map. Text → string, checkbox → bool, dropdown/radio → option string.',
    agentCallable: true,
    params: { values: { type: 'object', required: true } },
    run(doc, { values }) {
      const form = doc.pdf.getForm();
      const errors = [];
      for (const [name, val] of Object.entries(values)) {
        let field;
        try { field = form.getField(name); } catch { errors.push(`no field "${name}"`); continue; }
        const type = field.constructor?.name;
        try {
          if (type === 'PDFTextField') field.setText(val == null ? '' : String(val));
          else if (type === 'PDFCheckBox') { val ? field.check() : field.uncheck(); }
          else if (type === 'PDFDropdown' || type === 'PDFOptionList' || type === 'PDFRadioGroup') field.select(String(val));
          else errors.push(`unsupported field type for "${name}"`);
        } catch (e) { errors.push(`"${name}": ${e.message}`); }
      }
      if (errors.length) throw new Error(`Form fill: ${errors.join('; ')}`);
      return { doc };
    },
  },

  {
    id: 'forms.flatten', label: 'Flatten form', group: 'forms', icon: 'textbox',
    description: 'Bake the form values into the page content and remove interactivity (fields become permanent).',
    agentCallable: true,
    params: {},
    run(doc) {
      doc.pdf.getForm().flatten();
      return { doc };
    },
  },
];

// Re-export so the test fixture can build a form without re-importing the engine.
export { getEngine };
