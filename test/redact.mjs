// test/redact.mjs — THE redaction invariant: true content-stream removal.
// "extract text after redact → target text absent" (handoff §10). We redact a box
// over secret text and assert its bytes are GONE from the decoded content stream,
// while text outside the box survives.

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument, StandardFonts, PDFArray, decodePDFRawStream } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { tokenize, redactTokens } from '../src/ops/redact.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

// Content-stream hex is uppercase; compare case-insensitively.
const hexOf = (s) => [...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();

async function decodedContent(docBytes) {
  const d = await PDFDocument.load(docBytes);
  const page = d.getPage(0);
  const entry = page.node.Contents();
  const refs = entry instanceof PDFArray ? entry.asArray() : [entry];
  let all = '';
  for (const ref of refs) { try { all += new TextDecoder('latin1').decode(decodePDFRawStream(d.context.lookup(ref)).decode()); } catch {} }
  return all.toUpperCase();
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  const d = await PDFDocument.create();
  const page = d.addPage([300, 200]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET 12345', { x: 40, y: 150, size: 14, font: f }); // to be redacted
  page.drawText('KEEP VISIBLE', { x: 40, y: 100, size: 14, font: f }); // outside the box
  const src = await d.save({ updateMetadata: false });

  // Sanity: both strings present before redaction.
  const before = await decodedContent(src);
  ok('secret present before redaction', before.includes(hexOf('SECRET 12345')) || before.includes(hexOf('12345')));
  ok('keep present before redaction', before.includes(hexOf('KEEP VISIBLE')) || before.includes(hexOf('KEEP')));

  await dispatch('open.bytes', { bytes: src });
  // Box over the secret line (PDF y≈140..160 → normalized top-down y=0.2 h=0.1), full width.
  await dispatch('redact.region', { page: 0, x: 0, y: 0.2, w: 1, h: 0.1 });

  const after = await decodedContent(await state.doc.toBytes());
  console.log('\nTrue removal');
  ok('secret BYTES gone from content stream', !after.includes(hexOf('SECRET 12345')) && !after.includes(hexOf('12345')));
  ok('text outside the box survives', after.includes(hexOf('KEEP VISIBLE')) || after.includes(hexOf('KEEP')));
  ok('document still valid (1 page)', state.doc.pageCount() === 1);
  ok('reloadable after redaction', (await PDFDocument.load(await state.doc.toBytes())).getPageCount() === 1);

  console.log('\nInline-image robustness (no desync; image bytes survive)');
  // An inline image whose binary data contains "(Tj)" — a naive tokenizer would parse
  // that as a string + operator and desync the text below it.
  const imgData = '\x01\x02(Tj)\x03\x9f';
  const stream =
    `BT /F1 12 Tf 1 0 0 1 50 700 Tm <48656C6C6F> Tj ET\n` +            // "Hello" at y=700 (keep)
    `q 100 0 0 100 50 480 cm BI /W 2 /H 2 /BPC 8 ID ${imgData} EI Q\n` + // inline image
    `BT /F1 12 Tf 1 0 0 1 50 400 Tm <5365637265743132> Tj ET`;          // secret at y=400 (redact)
  const box = { x0: 0, y0: 390, x1: 600, y1: 412 };
  const { text: outStream, dirty } = redactTokens(tokenize(stream), [box]);
  ok('redaction fired (dirty)', dirty === true);
  ok('inline-image bytes survive verbatim', outStream.includes(imgData));
  ok('text above the image untouched', outStream.includes('48656C6C6F'));
  ok('targeted text below the image removed (no desync)', !outStream.includes('5365637265743132'));

  console.log('\nDirty-stream optimization (no-match leaves stream intact)');
  const clean = redactTokens(tokenize(stream), [{ x0: 0, y0: 0, x1: 1, y1: 1 }]); // box matches nothing
  ok('no match → not dirty', clean.dirty === false);

  console.log('\nIngress');
  let threw = false; try { await dispatch('redact.region', { page: 9, x: 0, y: 0, w: 1, h: 0.1 }); } catch { threw = true; }
  ok('out-of-range page rejected', threw);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
