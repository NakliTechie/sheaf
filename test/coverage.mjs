// test/coverage.mjs — UB-8 backfill for headless-testable ops that lacked a dedicated
// suite: pages.extract, pages.merge (end/start), and a full-field metadata round-trip.
// Browser-only ops (convert.pageImage, ocr.*, compress.rasterize) need a runtime test and
// are intentionally NOT faked here.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function docBytes(widths) {
  const d = await PDFDocument.create();
  for (const w of widths) d.addPage([w, 200]);
  return d.save({ updateMetadata: false });
}
async function open(widths) { await dispatch('open.bytes', { bytes: await docBytes(widths) }); }
const reload = async () => PDFDocument.load(await state.doc.toBytes());
const widths = async () => (await reload()).getPages().map(p => Math.round(p.getWidth()));

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('pages.extract');
  await open([100, 200, 300, 400]);
  await dispatch('pages.extract', { pages: [0, 2] });
  ok('extract [0,2] → widths [100,300]', JSON.stringify(await widths()) === JSON.stringify([100, 300]));

  console.log('\npages.merge (end / start)');
  await open([100, 200]);
  await dispatch('pages.merge', { bytes: await docBytes([300]), position: 'end' });
  ok('merge at end → [100,200,300]', JSON.stringify(await widths()) === JSON.stringify([100, 200, 300]));
  await open([100, 200]);
  await dispatch('pages.merge', { bytes: await docBytes([300]), position: 'start' });
  ok('merge at start → [300,100,200]', JSON.stringify(await widths()) === JSON.stringify([300, 100, 200]));

  console.log('\nmetadata.set / get — full-field round-trip');
  await open([100]);
  await dispatch('metadata.set', { title: 'T', author: 'A', subject: 'S', keywords: 'k1, k2' });
  // Read back from the reloaded document to prove it persisted through save.
  const rl = await reload();
  ok('title persisted', rl.getTitle() === 'T');
  ok('author persisted', rl.getAuthor() === 'A');
  ok('subject persisted', rl.getSubject() === 'S');
  ok('keywords persisted', (rl.getKeywords() || '').includes('k1') && (rl.getKeywords() || '').includes('k2'));

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
