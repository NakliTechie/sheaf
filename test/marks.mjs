// test/marks.mjs — the marks group (watermark, page numbers, Bates, header/footer).
// Verifies each applies cleanly, preserves the page count, produces a reloadable PDF,
// and — critically — is DETERMINISTIC: the same op on the same input yields identical
// bytes (no timestamps, no randomness), so marks replay and pipeline cleanly.

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function sample(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([400, 560]);
  d.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  d.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  return d.save({ updateMetadata: false });
}

function bytesEqual(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

async function applySequence(bytes) {
  await dispatch('open.bytes', { bytes });
  await dispatch('marks.watermark', { text: 'CONFIDENTIAL' });
  await dispatch('marks.pageNumbers', { format: '{n} / {total}' });
  await dispatch('marks.bates', { prefix: 'ACME', startAt: 1, digits: 6 });
  await dispatch('marks.text', { text: 'Sheaf', position: 'top-left' });
  return state.doc.toBytes();
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  const src = await sample(3);

  console.log('\nMarks apply + preserve structure');
  const out1 = await applySequence(src);
  ok('page count preserved (3)', state.doc.pageCount() === 3);
  const reloaded = await PDFDocument.load(out1, { updateMetadata: false });
  ok('output is a valid, reloadable PDF', reloaded.getPageCount() === 3);
  ok('modification date untouched', String(state.doc.getMetadata().modificationDate).startsWith('2020-01-01'));

  console.log('\nDeterminism (no timestamps / randomness)');
  const out2 = await applySequence(src);
  ok('same marks on same input → identical bytes', bytesEqual(out1, out2));

  console.log('\nValidation');
  let threw = false;
  try { await dispatch('marks.watermark', {}); } catch { threw = true; }
  ok('watermark requires text', threw);
  threw = false;
  try { await dispatch('marks.pageNumbers', { position: 'middle' }); } catch { threw = true; }
  ok('invalid position rejected at ingress', threw);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH', e); process.exit(2); });
