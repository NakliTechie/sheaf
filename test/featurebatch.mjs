// test/featurebatch.mjs — the 2026-08-21 page-ops & marks expansion (FB-1..FB-4).
// Pages carry distinct widths so order is observable after a reorder.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function openWidths(widths) {
  const d = await PDFDocument.create();
  d.setTitle('kept-title');
  for (const w of widths) d.addPage([w, 200]);
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}
const widthsNow = async () => (await PDFDocument.load(await state.doc.toBytes())).getPages().map(p => Math.round(p.getWidth()));

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('FB-1 — pages.reverse');
  await openWidths([100, 200, 300]);
  await dispatch('pages.reverse', {});
  const rev = await widthsNow();
  ok('order reversed [100,200,300] → [300,200,100]', JSON.stringify(rev) === JSON.stringify([300, 200, 100]));
  ok('title preserved through reverse', (await PDFDocument.load(await state.doc.toBytes())).getTitle() === 'kept-title');
  await dispatch('pages.reverse', {});
  ok('reverse twice = identity', JSON.stringify(await widthsNow()) === JSON.stringify([100, 200, 300]));

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
