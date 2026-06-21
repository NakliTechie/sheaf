// test/sign.mjs — appearance signing: applies, preserves structure, and is
// deterministic because the date is a parameter (not the clock).

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

async function sample() { const d = await PDFDocument.create(); d.addPage([400, 560]); d.setModificationDate(new Date('2020-01-01T00:00:00Z')); return d.save({ updateMetadata: false }); }
async function seq(bytes) {
  await dispatch('open.bytes', { bytes });
  await dispatch('sign.place', { page: 0, x: 0.1, y: 0.8, name: 'Ada Lovelace →', dateText: '2026-06-21' }); // arrow exercises winAnsiSafe
  return state.doc.toBytes();
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();
  const src = await sample();
  const out1 = await seq(src);
  ok('signed, page count preserved', state.doc.pageCount() === 1);
  ok('reloadable', (await PDFDocument.load(out1)).getPageCount() === 1);
  ok('no crash on non-WinAnsi name (arrow)', true);
  ok('deterministic (date is a param)', eq(out1, await seq(src)));
  let threw = false; try { await dispatch('sign.place', { page: 0, x: 0.1, y: 0.1 }); } catch { threw = true; }
  ok('name required', threw);
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
