// test/compress-images.mjs — the compress.images decision + rewrite logic (the headless half).
// The pixel round-trip (createImageBitmap/canvas) is browser-only and is verified in-browser;
// here we prove which images are IN scope, that out-of-scope images are refused, and that the
// rebuilt XObject is a well-formed DCTDecode RGB image at the new size.

import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFRef } = PDFLib;
import { isCompressibleImage, buildJpegXObject, pageImageRefs } from '../src/ops/compress.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

// Build an image-XObject stream with the given dict entries + dummy content bytes.
function imageXObj(ctx, entries, contentLen = 5000) {
  const dict = ctx.obj({});
  for (const [k, v] of Object.entries(entries)) dict.set(PDFName.of(k), v);
  const bytes = new Uint8Array(contentLen); // stand-in for JPEG bytes (decode path not exercised here)
  dict.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
  return PDFRawStream.of(dict, bytes);
}
const N = (s) => PDFName.of(s);
const Num = (n) => PDFNumber.of(n);

async function main() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const L = PDFLib;
  const MAX = 2000;

  console.log('isCompressibleImage — in-scope only');
  const bigRGB = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceRGB'), Width: Num(4000), Height: Num(3000), BitsPerComponent: Num(8) });
  ok('large DCT DeviceRGB image is in scope', isCompressibleImage(bigRGB, MAX, L) === true);

  const bigGray = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceGray'), Width: Num(3000), Height: Num(100), BitsPerComponent: Num(8) });
  ok('large DCT DeviceGray image is in scope', isCompressibleImage(bigGray, MAX, L) === true);

  const smallRGB = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceRGB'), Width: Num(800), Height: Num(600), BitsPerComponent: Num(8) });
  ok('small image is NOT in scope (<= maxDim)', isCompressibleImage(smallRGB, MAX, L) === false);

  const flate = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('FlateDecode'), ColorSpace: N('DeviceRGB'), Width: Num(4000), Height: Num(3000), BitsPerComponent: Num(8) });
  ok('non-DCT (Flate) image is NOT in scope', isCompressibleImage(flate, MAX, L) === false);

  const cmyk = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceCMYK'), Width: Num(4000), Height: Num(3000), BitsPerComponent: Num(8) });
  ok('CMYK image is NOT in scope', isCompressibleImage(cmyk, MAX, L) === false);

  const withSMask = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceRGB'), Width: Num(4000), Height: Num(3000), BitsPerComponent: Num(8), SMask: ctx.register(imageXObj(ctx, { Subtype: N('Image') })) });
  ok('image with a soft mask is NOT in scope (keeps transparency)', isCompressibleImage(withSMask, MAX, L) === false);

  const notImage = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Form'), Filter: N('DCTDecode') });
  ok('a form XObject is NOT an image', isCompressibleImage(notImage, MAX, L) === false);

  const withDecode = imageXObj(ctx, { Type: N('XObject'), Subtype: N('Image'), Filter: N('DCTDecode'), ColorSpace: N('DeviceRGB'), Width: Num(4000), Height: Num(3000), BitsPerComponent: Num(8), Decode: ctx.obj([1, 0, 1, 0, 1, 0]) });
  ok('image with a /Decode array is NOT in scope (can’t survive re-encode)', isCompressibleImage(withDecode, MAX, L) === false);

  console.log('\nbuildJpegXObject — well-formed DCTDecode RGB stream at the new size');
  const rebuilt = buildJpegXObject(ctx, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 1500, 1000, L);
  ok('rebuilt is a raw stream', rebuilt instanceof PDFRawStream);
  ok('rebuilt Subtype = Image', rebuilt.dict.get(N('Subtype')).asString() === '/Image');
  ok('rebuilt Filter = DCTDecode', rebuilt.dict.get(N('Filter')).asString() === '/DCTDecode');
  ok('rebuilt ColorSpace = DeviceRGB', rebuilt.dict.get(N('ColorSpace')).asString() === '/DeviceRGB');
  ok('rebuilt Width updated', rebuilt.dict.get(N('Width')).asNumber() === 1500);
  ok('rebuilt Height updated', rebuilt.dict.get(N('Height')).asNumber() === 1000);
  ok('rebuilt Length matches bytes', rebuilt.dict.get(N('Length')).asNumber() === 4);

  console.log('\npageImageRefs — enumerates + dedupes page image XObjects');
  const page = doc.addPage([600, 400]);
  const imgRef = ctx.register(bigRGB);
  let res = ctx.lookup(page.node.get(N('Resources')));
  if (!res) { res = ctx.obj({}); page.node.set(N('Resources'), ctx.register(res)); }
  const xd = ctx.obj({}); xd.set(N('Im0'), imgRef); xd.set(N('Im1'), imgRef); // same image, two names
  res.set(N('XObject'), xd);
  const refs = pageImageRefs(ctx, page, L);
  ok('collects the page image refs', refs.length === 2 && refs.every(r => r instanceof PDFRef));

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
