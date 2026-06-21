// test/forms.mjs — AcroForm detect/fill/flatten + text whiteout.

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function formPdf() {
  const d = await PDFDocument.create();
  const page = d.addPage([400, 560]);
  const form = d.getForm();
  const name = form.createTextField('applicant.name'); name.setText(''); name.addToPage(page, { x: 40, y: 480, width: 200, height: 20 });
  const agree = form.createCheckBox('agree'); agree.addToPage(page, { x: 40, y: 440, width: 16, height: 16 });
  const color = form.createDropdown('favColor'); color.setOptions(['red', 'green', 'blue']); color.addToPage(page, { x: 40, y: 400, width: 120, height: 20 });
  d.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  return d.save({ updateMetadata: false });
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('\nForms — detect');
  await dispatch('open.bytes', { bytes: await formPdf() });
  let det = (await dispatch('forms.detect', {})).artifact;
  ok('detected 3 fields', det.fieldCount === 3);
  const byName = Object.fromEntries(det.fields.map(f => [f.name, f]));
  ok('text field typed', byName['applicant.name']?.type === 'textfield' || byName['applicant.name']?.type === 'text');
  ok('checkbox typed', byName['agree']?.type === 'checkbox');
  ok('dropdown has options', Array.isArray(byName['favColor']?.options) && byName['favColor'].options.includes('green'));

  console.log('\nForms — fill');
  await dispatch('forms.fill', { values: { 'applicant.name': 'Ada Lovelace', 'agree': true, 'favColor': 'green' } });
  det = (await dispatch('forms.detect', {})).artifact;
  const filled = Object.fromEntries(det.fields.map(f => [f.name, f.value]));
  ok('text value set', filled['applicant.name'] === 'Ada Lovelace');
  ok('checkbox checked', filled['agree'] === true);
  ok('dropdown selected', JSON.stringify(filled['favColor']) === JSON.stringify(['green']) || filled['favColor']?.includes?.('green'));

  console.log('\nForms — fill validation + flatten');
  let threw = false; try { await dispatch('forms.fill', { values: { 'nope': 'x' } }); } catch { threw = true; }
  ok('unknown field rejected (loud)', threw);
  await dispatch('forms.flatten', {});
  det = (await dispatch('forms.detect', {})).artifact;
  ok('flatten removes interactivity (0 fields)', det.fieldCount === 0);
  ok('still a valid PDF after flatten', state.doc.pageCount() === 1);

  console.log('\nText — whiteout & retype');
  const before = state.doc.pageCount();
  await dispatch('text.whiteout', { page: 0, x: 0.1, y: 0.2, w: 0.5, h: 0.04, text: 'REDACTED→replaced' });
  ok('whiteout preserved page count', state.doc.pageCount() === before);
  ok('reloadable after whiteout', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === before);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
