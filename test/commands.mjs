// test/commands.mjs — the common-rail door, headless. commands.json must obey the host's
// catalog rules and match the handlers; the handlers must run the real runner, return
// plain data, refuse what a command may not do, and register only when hosted, whatever
// the developer setting says. Run: `node test/commands.mjs`.

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import * as PDFLib from '../engines/pdf-lib/2.9.1/pdf-lib.esm.js';
const { PDFDocument } = PDFLib;
import { registerEngine } from '../src/core/engines.js';
import { registerOps } from '../src/ops/index.js';
import { dispatch, replayFromFloor } from '../src/core/runner.js';
import { state } from '../src/core/state.js';
import { catalog } from '../src/core/registry.js';
import { createCommandHandlers, registerCommands, runnableOps } from '../src/core/commands.js';

let passed = 0, failed = 0;
const ok = (n, c) => {
  if (c) passed++; else failed++;
  console.log(`  ${c ? '✓' : '✗'} ${n}`);
};
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The host's rules, from naklios sys/host/catalog.mjs.
const NAME = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,3}$/;
const SCOPES = ['read', 'write', 'destructive'];
const MAX_COMMANDS = 64;

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('commands.json'));
const { commands } = manifest;

async function open(pages) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([100 + i, 200]);
  await dispatch('open.bytes', { bytes: await d.save({ updateMetadata: false }) });
}

// One fake page per case: registerCommands reads window, fetch and console.warn.
async function hostedRun({ parent, sdk = true, fetchImpl, registerImpl }) {
  const calls = { fetched: [], registered: null, warned: 0 };
  const win = { naklios: sdk ? { experimental_commands: { register: async (list) => { calls.registered = list; return registerImpl?.(list); } } } : undefined };
  win.parent = parent === 'self' ? win : {};
  const real = { warn: console.warn, fetch: globalThis.fetch };
  globalThis.window = win;
  globalThis.fetch = async (url) => { calls.fetched.push(url); return fetchImpl ? fetchImpl() : { json: async () => manifest }; };
  console.warn = () => { calls.warned++; };
  try {
    registerCommands();
    await new Promise(resolve => setTimeout(resolve, 5));
  } finally {
    delete globalThis.window;
    globalThis.fetch = real.fetch;
    console.warn = real.warn;
  }
  return calls;
}

let handlers, run, runnable;

async function manifestRules() {
  console.log('commands.json against the host catalog rules');
  ok('a list within the host limit', Array.isArray(commands) && commands.length > 0 && commands.length <= MAX_COMMANDS);
  ok('names pass the host pattern', commands.every(c => NAME.test(c.name)));
  ok('names are unique', new Set(commands.map(c => c.name)).size === commands.length);
  ok('scopes are read, write or destructive', commands.every(c => SCOPES.includes(c.scope)));
  ok('each input is an object schema', commands.every(c => c.input?.type === 'object' && typeof c.input.properties === 'object'));
  ok('required keys are declared properties', commands.every(c => (c.input.required || []).every(k => k in c.input.properties)));
  ok('each description is one sentence with an example phrase', commands.every(c => /e\.g\. ".+"/.test(c.description) && !/[.!?]\s+[A-Z]/.test(c.description.replace(/e\.g\./, ''))));
}

async function manifestMatchesHandlers() {
  console.log('\ncommands.json and the handlers match');
  ok('every command has a handler and every handler a command', same(commands.map(c => c.name).toSorted(), Object.keys(handlers).toSorted()));
  const opRule = commands.find(c => c.name === 'operation.run').input.properties.op;
  ok('the op enum is exactly the runnable ops', same([...opRule.enum].toSorted(), [...runnable].toSorted()));
  ok('no open op is runnable', !runnable.some(id => id.startsWith('open.')));
  ok('no artifact op is runnable', !runnable.includes('convert.text') && !runnable.includes('forms.detect'));
  ok('no op that takes bytes is runnable', !runnable.includes('pages.merge') && !runnable.includes('pages.insertImages'));
}

async function noDocument() {
  console.log('\nwith no document open');
  state.doc = null;
  ok('document.read says none is open', same(await handlers['document.read']({}), { open: false, message: 'No PDF is open in Sheaf.' }));
  ok('operation.run refuses', await rejects(() => run({ op: 'pages.reverse' }), /No document open/));
  ok('operation.undo refuses', await rejects(() => handlers['operation.undo']({}), /No PDF is open/));
}

async function reads() {
  console.log('\nreads');
  await open(3);
  state.session.fileName = 'contract.pdf';
  state.session.files = [];
  const list = await handlers['operations.list']({});
  ok('operations.list gives the runnable ops', same(list.operations.map(o => o.id), runnable));
  ok('operations.list is plain data', same(structuredClone(list), JSON.parse(JSON.stringify(list))));
  const doc = await handlers['document.read']({});
  ok('document.read gives name and page count', doc.fileName === 'contract.pdf' && doc.pageCount === 3 && doc.pages.length === 3);
  ok('document.read is plain data', same(structuredClone(doc), JSON.parse(JSON.stringify(doc))));
  ok('document.read has no folder outside folder mode', doc.folder === null);
  state.session.files = [{ name: 'a.pdf', handle: {} }, { name: 'b.pdf', handle: {} }];
  state.session.currentIndex = 1;
  const inFolder = await handlers['document.read']({});
  ok('document.read lists folder names and no handles', same(inFolder.folder, { count: 2, current: 1, names: ['a.pdf', 'b.pdf'] }));
  state.session.files = [];
  state.session.currentIndex = 0;
  await open(60);
  const long = await handlers['document.read']({});
  ok('a long PDF keeps its count and caps its page list', long.pageCount === 60 && long.pages.length === 50);
}

async function operationRun() {
  console.log('\noperation.run');
  await open(3);
  const result = await run({ op: 'pages.rotate', params: { pages: [0], angle: 90 } });
  ok('the op ran through the runner', state.doc.pages()[0].rotation === 90 && state.history.size === 1);
  ok('the result is plain data with no document', same(structuredClone(result), JSON.parse(JSON.stringify(result))) && !('doc' in result));
  ok('the result reports the unsaved change', result.op === 'pages.rotate' && result.pageCount === 3 && result.unsaved === true && result.canUndo === true);
  ok('an op with no params needs no params key', (await run({ op: 'pages.reverse' })).pageCount === 3);
  ok('bad params come back as an error', await rejects(() => run({ op: 'pages.rotate', params: { pages: 'all' } }), /./));
  const before = state.history.size;
  ok('an open op is refused', await rejects(() => run({ op: 'open.blank' }), /cannot run as a command/));
  ok('an artifact op is refused', await rejects(() => run({ op: 'convert.text' }), /cannot run as a command/));
  ok('a bytes op is refused', await rejects(() => run({ op: 'pages.merge' }), /cannot run as a command/));
  ok('an unknown op is refused', await rejects(() => run({ op: 'pages.nothing' }), /cannot run as a command/));
  ok('refused ops leave the document alone', state.doc.pageCount() === 3 && state.history.size === before);
}

async function concurrentCalls() {
  console.log('\nconcurrent calls');
  await open(4);
  await Promise.all([
    run({ op: 'pages.delete', params: { pages: [0] } }),
    run({ op: 'pages.delete', params: { pages: [0] } }),
    run({ op: 'pages.reverse' }),
  ]);
  ok('each call saw the result of the one before', state.doc.pageCount() === 2 && state.history.size === 3);
  ok('the op-log replays to the live document', await replayFromFloor().then(d => same(d.fingerprint(), state.doc.fingerprint())));
  await rejects(() => run({ op: 'pages.rotate', params: { pages: [99], angle: 90 } }), /./);
  ok('a failed call does not block the next', (await run({ op: 'pages.reverse' })).pageCount === 2);
}

async function operationUndo() {
  console.log('\noperation.undo');
  await open(2);
  await run({ op: 'pages.delete', params: { pages: [1] } });
  const undone = await handlers['operation.undo']({});
  ok('undo restores the page', undone.undone === true && undone.pageCount === 2 && state.doc.pageCount() === 2);
  ok('undo with nothing left says so', (await handlers['operation.undo']({})).undone === false);
}

async function registration() {
  console.log('\nregistration');
  ok('the developer setting is off in this suite', state.dev.agentFace === false);
  const hosted = await hostedRun({ parent: 'host' });
  ok('hosted: reads ./commands.json', same(hosted.fetched, ['./commands.json']));
  ok('hosted: registers every command with a handler', hosted.registered?.length === commands.length && hosted.registered.every(c => typeof c.handler === 'function'));
  ok('hosted: registers with the developer setting off', state.dev.agentFace === false && hosted.warned === 0);
  ok('standalone: fetches and registers nothing', same((await hostedRun({ parent: 'self' })).fetched, []));
  const noSdk = await hostedRun({ parent: 'host', sdk: false });
  ok('framed without the SDK: fetches nothing and does not throw', same(noSdk.fetched, []));
  const noFile = await hostedRun({ parent: 'host', fetchImpl: () => { throw new Error('offline'); } });
  ok('a failed fetch logs one warning', noFile.warned === 1 && noFile.registered === null);
  const refused = await hostedRun({ parent: 'host', registerImpl: () => { throw new Error('refused'); } });
  ok('a refused registration logs one warning', refused.warned === 1);
}

async function vendoredSdk() {
  console.log('\nthe vendored SDK');
  for (const file of ['src/index.html', 'index.html']) {
    const html = read(file);
    const begin = html.match(/\/\* naklios-sdk:begin ver=(\d+) sha256=([0-9a-f]{64}) [^\n]*\*\/\n/);
    const end = html.indexOf('\n/* naklios-sdk:end */');
    const body = begin && html.slice(begin.index + begin[0].length, end);
    ok(`${file}: the region matches its stamped hash`, !!begin && createHash('sha256').update(body, 'utf8').digest('hex') === begin[2]);
    ok(`${file}: the SDK sits before the app module`, end > 0 && end < html.indexOf('<script type="module"'));
  }
  ok('index.html carries the registration', read('index.html').includes("'./commands.json'"));
  const ignored = read('.assetsignore').split('\n');
  ok('commands.json deploys and scripts/ does not', !ignored.includes('commands.json') && !ignored.includes('*.json') && ignored.includes('scripts'));
}

async function main() {
  registerEngine('pdf-lib', PDFLib);
  registerOps();
  handlers = createCommandHandlers();
  run = handlers['operation.run'];
  runnable = runnableOps(catalog({ agentCallableOnly: true })).map(o => o.id);

  for (const section of [manifestRules, manifestMatchesHandlers, noDocument, reads, operationRun, concurrentCalls, operationUndo, registration, vendoredSdk]) await section();

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
