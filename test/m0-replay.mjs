// test/m0-replay.mjs — the M0 gate, headless.
//
//   "event-log replay reconstructs state"
//
// Runs a sequence of real ops through the runner, then replays the entire op-log
// from the origin and asserts the reconstructed document's fingerprint equals the
// live document's. Also exercises undo/redo, the single-ingress validator, and the
// agent catalog. pdf-lib runs in Node, so the deterministic core is provable with
// no browser. Run: `node test/m0-replay.mjs`.

import * as PDFLib from '../engines/pdf-lib/1.17.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch, undo, redo, replayFromFloor, exportPipeline } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { catalog, list } from '../src/core/registry.js';
import { ValidationError } from '../src/core/schema.js';

let passed = 0, failed = 0;
function ok(name, cond) { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}`); } }
function eq(name, a, b) { const r = JSON.stringify(a) === JSON.stringify(b); if (!r) console.log(`    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`); ok(name, r); }

const FIXED_DATE = new Date('2020-01-01T00:00:00Z');

async function makeSamplePdf(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([300 + i * 10, 400]);
    p.drawText(`Original page ${i + 1}`, { x: 40, y: 360 });
  }
  // Pin the dates so we can prove toBytes() never silently re-stamps them.
  d.setCreationDate(FIXED_DATE);
  d.setModificationDate(FIXED_DATE);
  return await d.save({ updateMetadata: false });
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();

  console.log('\nRegistry + catalog');
  ok('ops registered', list().length >= 10);
  ok('catalog exposes only agentCallable', catalog().every(o => o.params !== undefined) && catalog().length > 0);

  console.log('\nSingle ingress (schema) rejects bad input');
  let threw = false;
  try { await dispatch('pages.rotate', { pages: 'nope', angle: 90 }); } catch (e) { threw = e instanceof ValidationError; }
  ok('non-array pages → ValidationError', threw);
  threw = false;
  try { await dispatch('open.bytes', { bytes: new Uint8Array([1, 2, 3]) }); } catch (e) { threw = /PDF/.test(e.message); }
  ok('non-PDF bytes → rejected at ingress', threw);

  console.log('\nOpen + mutate sequence');
  const sample = await makeSamplePdf(5);
  await dispatch('open.bytes', { bytes: sample });
  eq('opened 5 pages', state.doc.pageCount(), 5);

  // A varied sequence touching every page-op kind + metadata.
  await dispatch('pages.rotate',      { pages: [0, 2], angle: 90 });
  await dispatch('pages.rotate',      { pages: [2], angle: 90 });        // 2 now at 180
  await dispatch('pages.delete',      { pages: [4] });                    // 5 → 4 pages
  await dispatch('pages.insertBlank', { at: 1, width: 200, height: 200 });// 4 → 5
  await dispatch('pages.duplicate',   { pages: [0] });                    // 5 → 6
  await dispatch('pages.reorder',     { order: [5, 4, 3, 2, 1, 0] });
  await dispatch('pages.scale',       { pages: [0], factor: 2 });
  await dispatch('metadata.set',      { title: 'Replayed', author: 'Sheaf', keywords: 'a, b, c' });

  const liveFp = state.doc.fingerprint();
  ok('live doc has 6 pages', liveFp.pageCount === 6);
  ok('metadata title set', liveFp.meta.title === 'Replayed');
  // Regression guard: pdf-lib's getPages() cache goes stale after in-place
  // removePage/insertPage. The runner normalizes every op through its bytes, so
  // pages().length and pageCount() must always agree.
  ok('pages().length === pageCount() (no stale getPages cache)', state.doc.pages().length === state.doc.pageCount());
  // toBytes() must NOT re-stamp the modification date (sovereignty + replay determinism).
  // After 8 ops + normalization round-trips, the pinned 2020 date must survive.
  ok('modificationDate not silently re-stamped', String(state.doc.getMetadata().modificationDate || '').startsWith('2020-01-01'));

  console.log('\nM0 GATE — replay the whole op-log from the floor');
  const replayed = await replayFromFloor();
  eq('replayed fingerprint === live fingerprint', replayed.fingerprint(), liveFp);
  const liveHash = await state.doc.fingerprintHash();
  const replHash = await replayed.fingerprintHash();
  ok('fingerprint hashes match', liveHash === replHash);

  console.log('\nUndo / redo walk the same log');
  const fpBeforeUndo = state.doc.fingerprint();
  await undo(); await undo();                          // step back 2
  const fpUndo2 = state.doc.fingerprint();
  ok('undo changed state', JSON.stringify(fpUndo2) !== JSON.stringify(fpBeforeUndo));
  await redo(); await redo();                          // step forward 2
  eq('redo returns to pre-undo state', state.doc.fingerprint(), fpBeforeUndo);

  console.log('\nUndo to floor, redo to tip');
  let guard = 0; while (await undo()) { if (++guard > 100) break; }
  eq('undone to original 5-page doc', state.doc.pageCount(), 5);
  guard = 0; while (await redo()) { if (++guard > 100) break; }
  eq('redone back to 6-page tip', state.doc.fingerprint(), liveFp);

  console.log('\nArtifact op + pipeline export');
  const meta = await dispatch('metadata.get', {});
  ok('metadata.get returns artifact, no doc mutation', meta.artifact && meta.artifact.author === 'Sheaf');
  const pipe = exportPipeline();
  ok('pipeline export is a model-free op list', pipe.tool === 'sheaf' && Array.isArray(pipe.ops) && pipe.ops.length === 8);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('\nTEST CRASHED:', e); process.exit(2); });
