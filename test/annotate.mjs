// test/annotate.mjs — annotation ops (highlight, rect, line, pencil, textbox).
// Each applies, preserves page count, yields a reloadable PDF, validates its
// normalized coords through the single ingress, and is byte-deterministic.

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
  d.setModificationDate(new Date('2020-01-01T00:00:00Z'));
  return d.save({ updateMetadata: false });
}
const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

async function seq(bytes) {
  await dispatch('open.bytes', { bytes });
  await dispatch('annotate.highlight', { page: 0, x: 0.1, y: 0.1, w: 0.5, h: 0.06 });
  await dispatch('annotate.rect', { page: 0, x: 0.1, y: 0.3, w: 0.4, h: 0.2, fill: true });
  await dispatch('annotate.line', { page: 1, x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.5, arrow: true });
  await dispatch('annotate.pencil', { page: 1, points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.5, y: 0.3 }] });
  await dispatch('annotate.textbox', { page: 2, x: 0.1, y: 0.2, text: 'Reviewed\nby Sheaf', fontSize: 18 });
  return state.doc.toBytes();
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();
  const src = await sample(3);

  console.log('\nAnnotations apply + preserve structure');
  const out1 = await seq(src);
  ok('page count preserved (3)', state.doc.pageCount() === 3);
  ok('reloadable PDF', (await PDFDocument.load(out1)).getPageCount() === 3);
  ok('mod date untouched', String(state.doc.getMetadata().modificationDate).startsWith('2020-01-01'));

  console.log('\nDeterminism');
  ok('same annotations → identical bytes', eq(out1, await seq(src)));

  console.log('\nIngress validation');
  let threw = false; try { await dispatch('annotate.highlight', { page: 0, x: 0.1 }); } catch { threw = true; }
  ok('missing required coords rejected', threw);
  threw = false; try { await dispatch('annotate.pencil', { page: 0, points: [{ x: 0.1, y: 0.1 }] }); } catch { threw = true; }
  ok('pencil needs >= 2 points', threw);
  threw = false; try { await dispatch('annotate.textbox', { page: 9, x: 0.1, y: 0.1, text: 'x' }); } catch { threw = true; }
  ok('out-of-range page rejected', threw);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
