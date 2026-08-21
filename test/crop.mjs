// test/crop.mjs — pages.crop sets the CropBox from a normalized top-left rect.
// Crop is visible-area only (no content removed), so it must be reversible and must
// map the normalized region to the correct PDF (bottom-left origin) box.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument, StandardFonts } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

async function open2page() {
  const d = await PDFDocument.create();
  const p1 = d.addPage([400, 300]);
  const p2 = d.addPage([400, 300]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  p1.drawText('page one', { x: 20, y: 260, size: 16, font: f });
  p2.drawText('page two', { x: 20, y: 260, size: 16, font: f });
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('pages.crop — CropBox math + scope');
  await open2page();
  // Crop page 0 to the top-left quarter: x=0,y=0,w=0.5,h=0.5 on a 400×300 page.
  // Expected PDF box: x=0, y=H*(1-(0+0.5))=150, w=200, h=150 → [0,150,200,300].
  await dispatch('pages.crop', { pages: [0], x: 0, y: 0, w: 0.5, h: 0.5 });
  const bytes = await state.doc.toBytes();
  const re = await PDFDocument.load(bytes);
  const cb = re.getPage(0).getCropBox();
  ok('crop x maps to 0', near(cb.x, 0));
  ok('crop y maps to H*(1-(y+h)) = 150', near(cb.y, 150));
  ok('crop width = w*W = 200', near(cb.width, 200));
  ok('crop height = h*H = 150', near(cb.height, 150));

  // Page 1 was not targeted — its CropBox stays the full page (400×300).
  const cb1 = re.getPage(1).getCropBox();
  ok('untargeted page keeps full CropBox', near(cb1.width, 400) && near(cb1.height, 300));
  ok('document still 2 pages, reloadable', re.getPageCount() === 2);

  console.log('\nReversibility + clamping');
  // Re-crop page 0 back to the full page → CropBox equals MediaBox again.
  await dispatch('pages.crop', { pages: [0], x: 0, y: 0, w: 1, h: 1 });
  const back = (await PDFDocument.load(await state.doc.toBytes())).getPage(0).getCropBox();
  ok('crop to full page restores full CropBox', near(back.width, 400) && near(back.height, 300));

  // A rect running past the edge clamps to the page rather than erroring.
  await open2page();
  await dispatch('pages.crop', { pages: [0], x: 0.8, y: 0.8, w: 0.5, h: 0.5 });
  const clamped = (await PDFDocument.load(await state.doc.toBytes())).getPage(0).getCropBox();
  ok('over-edge rect clamps (w = (1-0.8)*400 = 80)', near(clamped.width, 80));

  // A zero-area rect is rejected loudly.
  await open2page();
  let threw = false;
  try { await dispatch('pages.crop', { pages: [0], x: 0.5, y: 0.5, w: 0, h: 0.3 }); }
  catch { threw = true; }
  ok('zero-width crop rejected', threw);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
