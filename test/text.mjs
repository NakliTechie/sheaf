// test/text.mjs — font-matched whiteout-and-retype. The span-replace op (ui/spanedit.js
// detects family/weight/slant/baseline; ops/text.js draws in the matched Standard-14
// face on the original baseline). This locks: every family×weight×slant combo embeds and
// renders to a valid PDF, and the baseline param is honored without error.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument, StandardFonts } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function freshDoc() {
  const d = await PDFDocument.create();
  const page = d.addPage([320, 200]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  page.drawText('original text', { x: 40, y: 120, size: 14, font: f });
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('Font-matched retype — every family × weight × slant');
  const families = ['sans', 'serif', 'mono'];
  for (const family of families) {
    for (const bold of [false, true]) {
      for (const italic of [false, true]) {
        await freshDoc();
        await dispatch('text.whiteout', {
          page: 0, x: 0.1, y: 0.35, w: 0.6, h: 0.09,
          text: 'replaced', fontSize: 14,
          fontFamily: family, bold, italic, baseline: 0.42,
        });
        const bytes = await state.doc.toBytes();
        const re = await PDFDocument.load(bytes);
        const label = `${family}${bold ? '+bold' : ''}${italic ? '+italic' : ''}`;
        ok(`${label} → valid reloadable PDF`, re.getPageCount() === 1 && bytes.length > 0);
      }
    }
  }

  console.log('\nBaseline + fallback behavior');
  // Explicit baseline honored.
  await freshDoc();
  await dispatch('text.whiteout', { page: 0, x: 0.1, y: 0.3, w: 0.6, h: 0.1, text: 'on baseline', fontSize: 14, fontFamily: 'serif', baseline: 0.4 });
  ok('explicit baseline retype valid', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === 1);

  // No baseline (null) → centered fallback, still valid.
  await freshDoc();
  await dispatch('text.whiteout', { page: 0, x: 0.1, y: 0.3, w: 0.6, h: 0.1, text: 'centered', fontSize: 14 });
  ok('null baseline centers without error', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === 1);

  // Whiteout-only (no text) still covers.
  await freshDoc();
  await dispatch('text.whiteout', { page: 0, x: 0.1, y: 0.3, w: 0.6, h: 0.1 });
  ok('whiteout-only (no retype) valid', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === 1);

  // Unknown family string degrades to sans (Helvetica), no throw.
  await freshDoc();
  await dispatch('text.whiteout', { page: 0, x: 0.1, y: 0.3, w: 0.6, h: 0.1, text: 'weird', fontSize: 12, fontFamily: 'fantasy' });
  ok('unknown family degrades to sans', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === 1);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
