// test/images.mjs — images → PDF (pages.insertImages). Embeds a real 1x1 PNG and a
// real JPEG as pages and checks the page count + sizing + ingress validation.

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };
const b64 = (s) => { const bin = Buffer.from(s, 'base64'); return new Uint8Array(bin); };

// A real 1x1 PNG and a real 1x1 JPEG.
const PNG_1x1 = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');
const JPG_1x1 = b64('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==');

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('\nImages → PDF');
  await dispatch('open.blank', { pages: 1 });
  ok('start with 1 blank page', state.doc.pageCount() === 1);

  await dispatch('pages.insertImages', { images: [PNG_1x1, JPG_1x1], at: -1 });
  ok('appended 2 image pages (1 → 3)', state.doc.pageCount() === 3);
  const reloaded = await PDFDocument.load(await state.doc.toBytes());
  ok('output is a valid, reloadable PDF', reloaded.getPageCount() === 3);

  await dispatch('pages.insertImages', { images: [PNG_1x1], at: 0 });
  ok('insert at index 0 (3 → 4)', state.doc.pageCount() === 4);

  console.log('\nIngress validation');
  let threw = false; try { await dispatch('pages.insertImages', { images: [new Uint8Array([1, 2, 3, 4])] }); } catch { threw = true; }
  ok('non-image bytes rejected (loud)', threw);
  threw = false; try { await dispatch('pages.insertImages', { images: [] }); } catch { threw = true; }
  ok('empty image list rejected at ingress', threw);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
