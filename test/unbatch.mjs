// test/unbatch.mjs — the 2026-08-21 unattended batch (UB-*). Pages carry distinct widths
// so order/range are observable.

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
  d.setTitle('kept');
  for (const w of widths) d.addPage([w, 200]);
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}
const reload = async () => PDFDocument.load(await state.doc.toBytes());
const widths = async () => (await reload()).getPages().map(p => Math.round(p.getWidth()));
const rejects = async (id, p) => { try { await dispatch(id, p); return false; } catch { return true; } };

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('UB-1 — pages.orient (absolute rotation)');
  await openWidths([100, 100]);
  await dispatch('pages.orient', { pages: [0], angle: 180 });
  ok('page 0 set to 180', (await reload()).getPage(0).getRotation().angle === 180);
  await dispatch('pages.orient', { pages: [0], angle: 90 });
  await dispatch('pages.orient', { pages: [0], angle: 90 });
  ok('absolute (twice to 90 = 90, not 180)', (await reload()).getPage(0).getRotation().angle === 90);
  ok('non-cardinal angle rejected (enum)', await rejects('pages.orient', { pages: [0], angle: 45 }));

  console.log('\nUB-2 — pages.keepRange');
  await openWidths([100, 200, 300, 400]);
  await dispatch('pages.keepRange', { from: 1, to: 2 });
  ok('keep [1..2] → widths [200,300]', JSON.stringify(await widths()) === JSON.stringify([200, 300]));
  ok('title carried through keepRange', (await reload()).getTitle() === 'kept');
  await openWidths([100, 200, 300, 400]);
  ok('from > to rejected', await rejects('pages.keepRange', { from: 3, to: 1 }));
  ok('out-of-range rejected', await rejects('pages.keepRange', { from: 0, to: 9 }));

  console.log('\nUB-3 — pages.addMargin');
  await openWidths([200]);
  await dispatch('pages.addMargin', { margin: 20 });
  const mb = (await reload()).getPage(0).getMediaBox();
  ok('media box grew by 2*margin (200→240 wide)', Math.round(mb.width) === 240);
  ok('media box grew by 2*margin (200→240 tall)', Math.round(mb.height) === 240);
  ok('origin shifted by -margin (x=-20)', Math.round(mb.x) === -20);
  ok('still one page, reloadable', (await reload()).getPageCount() === 1);

  console.log('\nUB-5 — pages.nUp');
  // Pages must have content to be embeddable; draw text on each.
  const openContent = async (count) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let i = 0; i < count; i++) d.addPage([200, 300]).drawText(`page ${i}`, { x: 20, y: 260, size: 14, font: f });
    await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
  };
  await openContent(4);
  await dispatch('pages.nUp', { perSheet: 2 });
  ok('4 pages, 2-up → 2 sheets', (await reload()).getPageCount() === 2);
  await openContent(4);
  await dispatch('pages.nUp', { perSheet: 4 });
  ok('4 pages, 4-up → 1 sheet', (await reload()).getPageCount() === 1);
  await openContent(3);
  await dispatch('pages.nUp', { perSheet: 2 });
  ok('3 pages, 2-up → 2 sheets (last half-full)', (await reload()).getPageCount() === 2);
  ok('non-cardinal perSheet rejected', await rejects('pages.nUp', { perSheet: 3 }));
  // A blank (no-content) source page is skipped gracefully, not fatal.
  await openWidths([200, 200]);
  await dispatch('pages.nUp', { perSheet: 2 });
  ok('blank source pages → still 1 sheet, no crash', (await reload()).getPageCount() === 1);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
