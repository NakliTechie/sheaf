// test/sendto.mjs — PDFs sent from the NakliOS Files app, headless. A grant opens through
// the drop path, its token is always released, unsaved work goes through the guard, and
// nothing registers standalone. Run: `node test/sendto.mjs`.

import { readFileSync } from 'fs';
import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { on } from '../src/core/events.js';
import { openIncoming } from '../src/ui/fileops.js';
import { createSendHandler, initSendTo } from '../src/ui/sendto.js';

let passed = 0, failed = 0;
const ok = (n, c) => {
  if (c) passed++; else failed++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function pdf(pages) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([100, 200]);
  return d.save({ updateMetadata: false });
}

// A stand-in for naklios.files: answers read() from a map and records every release.
function fakeFiles(store) {
  const calls = { read: [], released: [] };
  return {
    calls,
    read: async (token) => {
      calls.read.push(token);
      if (!store[token]) throw new Error('grant expired');
      return store[token];
    },
    release: (token) => { calls.released.push(token); },
  };
}

const errors = [];
const agree = async () => true;
const decline = async () => false;
const realOpen = (confirm) => (load, failure) => openIncoming(load, failure, confirm);

async function manifest() {
  console.log('commands.json');
  const { accepts } = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'));
  ok('accepts PDFs as an import', same(accepts, [{ action: 'import', label: 'Open in Sheaf', extensions: ['.pdf'] }]));
}

async function opening() {
  console.log('\nopening a sent PDF');
  state.doc = null;
  state.dirty = false;
  const files = fakeFiles({ t1: { bytes: (await pdf(3)).buffer, name: 'sent.pdf' } });
  await createSendHandler(files, realOpen(agree))({ kind: 'send', token: 't1' });
  ok('the PDF opens from an ArrayBuffer', state.doc?.pageCount() === 3);
  ok('the name comes from the grant read', state.session.fileName === 'sent.pdf');
  ok('it has no file handle, so a save cannot reach the source', state.session.fileHandle === null);
  ok('the token is released', same(files.calls.released, ['t1']));
  const typed = fakeFiles({ t2: { bytes: await pdf(2), name: 'typed.pdf' } });
  await createSendHandler(typed, realOpen(agree))({ kind: 'send', token: 't2' });
  ok('the PDF opens from a Uint8Array', state.doc?.pageCount() === 2);
}

async function otherGrants() {
  console.log('\nother grants');
  const files = fakeFiles({});
  await createSendHandler(files, realOpen(agree))({ kind: 'file', token: 'x' });
  ok('a grant that is not a send is not read', same(files.calls.read, []));
  ok('and is left for its owner to release', same(files.calls.released, []));
}

async function guard() {
  console.log('\nunsaved work');
  await dispatch('open.blank', { pages: 1 });
  const before = state.doc;
  state.dirty = true;
  const files = fakeFiles({ t: { bytes: await pdf(5), name: 'new.pdf' } });
  await createSendHandler(files, realOpen(decline))({ kind: 'send', token: 't' });
  ok('declining keeps the open document', state.doc === before && state.dirty === true);
  ok('declining does not read the file', same(files.calls.read, []));
  ok('declining still releases the token', same(files.calls.released, ['t']));
  await createSendHandler(files, realOpen(agree))({ kind: 'send', token: 't' });
  ok('agreeing replaces it', state.doc.pageCount() === 5 && state.dirty === false);
  ok('the default guard is the one a drop uses', /confirm = confirmDiscardIfDirty/.test(openIncoming.toString()));
  ok('the drop path uses openIncoming', /await openIncoming\(/.test(readFileSync(new URL('../src/ui/welcome.js', import.meta.url), 'utf8')));
}

async function failures() {
  console.log('\nfailures');
  await dispatch('open.blank', { pages: 2 });
  const before = state.doc;
  errors.length = 0;
  const notPdf = fakeFiles({ bad: { bytes: new TextEncoder().encode('not a pdf'), name: 'bad.pdf' } });
  await createSendHandler(notPdf, realOpen(agree))({ kind: 'send', token: 'bad' });
  ok('a bad file reaches the error surface', errors.length === 1 && errors[0].message === 'Could not open the sent file');
  ok('a bad file leaves the open document', state.doc === before);
  ok('a bad file still releases the token', same(notPdf.calls.released, ['bad']));
  errors.length = 0;
  const gone = fakeFiles({});
  await createSendHandler(gone, realOpen(agree))({ kind: 'send', token: 'gone' });
  ok('a refused read reaches the error surface', errors.length === 1 && errors[0].detail === 'grant expired');
  ok('a refused read still releases the token', same(gone.calls.released, ['gone']));
}

async function ordering() {
  console.log('\nseveral files in one send');
  const files = fakeFiles({ a: { bytes: await pdf(1), name: 'a.pdf' }, b: { bytes: await pdf(2), name: 'b.pdf' } });
  const log = [];
  const handle = createSendHandler(files, async (load) => {
    const { name } = await load();
    log.push(`start ${name}`);
    await new Promise(resolve => setTimeout(resolve, 5));
    log.push(`end ${name}`);
  });
  handle({ kind: 'send', token: 'a' });
  await handle({ kind: 'send', token: 'b' });
  ok('grants open one at a time, in order', same(log, ['start a.pdf', 'end a.pdf', 'start b.pdf', 'end b.pdf']));
  const stuck = createSendHandler(files, async () => { throw new Error('guard failed'); });
  await stuck({ kind: 'send', token: 'a' });
  await stuck({ kind: 'send', token: 'b' });
  ok('a failed grant does not block the next', same(files.calls.released.slice(-2), ['a', 'b']));
}

async function wiring() {
  console.log('\nregistration');
  const run = (hosted, sdk) => {
    const win = { naklios: sdk };
    win.parent = hosted ? {} : win;
    globalThis.window = win;
    try { initSendTo(); } finally { delete globalThis.window; }
  };
  const order = [];
  const sdk = { files: { onOpen: (cb) => order.push(typeof cb) }, ready: () => order.push('ready') };
  run(true, sdk);
  ok('hosted: listens, then signals ready, because the host holds grants until ready', same(order, ['function', 'ready']));
  order.length = 0;
  run(false, sdk);
  ok('standalone: does nothing', same(order, []));
  run(true, undefined);
  ok('framed without the SDK: does not throw', same(order, []));
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();
  on('error', (e) => errors.push(e));
  for (const section of [manifest, opening, otherGrants, guard, failures, ordering, wiring]) await section();
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
