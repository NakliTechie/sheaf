// test/regress.mjs — forward-pass 2026-08-21 regressions: L2 (rotate/scale dedupe) and
// L3 (schema enum for numbers + array maxItems).

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { validateParams } from '../src/core/schema.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function open1() {
  const d = await PDFDocument.create();
  d.addPage([200, 300]);
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('L2 — rotate/scale dedupe repeated indices');
  await open1();
  await dispatch('pages.rotate', { pages: [0, 0, 0], angle: 90 });
  ok('rotate [0,0,0] applies 90° once, not 270°',
     (await PDFLib.PDFDocument.load(await state.doc.toBytes())).getPage(0).getRotation().angle === 90);

  await open1();
  await dispatch('pages.scale', { pages: [0, 0], factor: 2 });
  const scaled = (await PDFLib.PDFDocument.load(await state.doc.toBytes())).getPage(0).getSize();
  ok('scale [0,0] factor 2 doubles once (400 wide, not 800)', Math.round(scaled.width) === 400);

  console.log('\nL3 — schema enforces enum for numbers + array maxItems');
  const rejects = (schema, input) => { try { validateParams(schema, input); return false; } catch { return true; } };
  const accepts = (schema, input) => { try { validateParams(schema, input); return true; } catch { return false; } };
  const numEnum = { n: { type: 'int', enum: [90, 180, 270] } };
  ok('int outside enum rejected', rejects(numEnum, { n: 45 }));
  ok('int within enum accepted', accepts(numEnum, { n: 180 }));

  const arrCap = { items: { type: 'array', items: { type: 'int' }, maxItems: 2 } };
  ok('array over maxItems rejected', rejects(arrCap, { items: [1, 2, 3] }));
  ok('array within maxItems accepted', accepts(arrCap, { items: [1, 2] }));

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
