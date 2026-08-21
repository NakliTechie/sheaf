// test/featurebatch.mjs — the 2026-08-21 page-ops & marks expansion (FB-1..FB-4).
// Pages carry distinct widths so order is observable after a reorder.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { makeZip } from '../src/core/zip.js';

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

  console.log('\nFB-2 — marks.text (header/footer) draws content');
  await openWidths([400]);
  const beforeText = (await state.doc.toBytes()).length;
  await dispatch('marks.text', { text: 'CONFIDENTIAL', position: 'top-center' });
  const afterText = await state.doc.toBytes();
  ok('valid reloadable after header/footer', (await PDFDocument.load(afterText)).getPageCount() === 1);
  ok('content grew (text was drawn)', afterText.length > beforeText);

  console.log('\nFB-3 — marks.border draws a frame');
  await openWidths([400, 400]);
  const beforeB = (await state.doc.toBytes()).length;
  await dispatch('marks.border', { margin: 24, thickness: 2, color: '#333333', pages: [0] });
  const afterB = await state.doc.toBytes();
  ok('valid reloadable after border', (await PDFDocument.load(afterB)).getPageCount() === 2);
  ok('content grew (border drawn)', afterB.length > beforeB);
  // out-of-range page rejected loudly
  let borderThrew = false;
  try { await dispatch('marks.border', { pages: [9] }); } catch { borderThrew = true; }
  ok('border on out-of-range page rejected', borderThrew);
  // L2 dedupe: a repeated index draws once — [0,0,0] must equal [0].
  await openWidths([300]);
  await dispatch('marks.border', { pages: [0], margin: 24, thickness: 2 });
  const once = (await state.doc.toBytes()).length;
  await openWidths([300]);
  await dispatch('marks.border', { pages: [0, 0, 0], margin: 24, thickness: 2 });
  const thrice = (await state.doc.toBytes()).length;
  ok('resolvePages dedupes repeated indices (border [0,0,0] == [0])', once === thrice);

  console.log('\nFB-4 — convert.split into single-page PDFs + zip');
  await openWidths([100, 200, 300]);
  const res = await dispatch('convert.split', {}, { source: 'test' });
  const files = res.artifact?.files || [];
  ok('one file per page (3)', files.length === 3 && res.artifact.count === 3);
  const counts = [];
  for (const f of files) counts.push((await PDFDocument.load(f.bytes)).getPageCount());
  ok('every split file is a valid 1-page PDF', counts.every(c => c === 1));
  // widths preserved per split file (page i keeps its width)
  const w0 = Math.round((await PDFDocument.load(files[0].bytes)).getPage(0).getWidth());
  const w2 = Math.round((await PDFDocument.load(files[2].bytes)).getPage(0).getWidth());
  ok('split files keep per-page geometry (100 & 300)', w0 === 100 && w2 === 300);
  const zip = makeZip(files);
  ok('makeZip bundles them (valid zip signature, non-empty)', zip.length > 0 && zip[0] === 0x50 && zip[1] === 0x4b);
  ok('splitting the doc did not mutate it (still 3 pages open)', state.doc.pageCount() === 3);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
