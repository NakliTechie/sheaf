// test/ai.mjs — the nakli-ai primitive, headless, with a mocked provider. Covers the
// ladder (local detection), the single complete() verb, JSON parsing robustness, and
// the no-AI ground floor. (BYOK persistence + the PDF.js-backed sidecar surfaces are
// browser-side and verified there.)

import * as ai from '../src/core/ai.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

async function main() {
  console.log('\nNo-AI ground floor');
  ok('unavailable before any model', !ai.isAvailable());
  let threw = false; try { await ai.complete([{ role: 'user', content: 'hi' }]); } catch { threw = true; }
  ok('complete() refuses with no model (tool stays usable without it)', threw);
  ok('leakage description is honest when off', /off/i.test(ai.describeLeakage()));

  console.log('\nLadder — local detection (mocked)');
  let lastBody = null;
  ai._setFetch(async (url, opts) => {
    if (url.includes('/v1/models')) return { ok: true, json: async () => ({ data: [{ id: 'llama3.1' }] }) };
    if (url.includes('/chat/completions')) { lastBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: globalThis.__mock || 'hello' } }] }) }; }
    return { ok: false, status: 404, text: async () => '' };
  });
  const local = await ai.detectLocal({ timeoutMs: 200 });
  ok('detected a local bridge', !!local && local.model === 'llama3.1');
  ok('tier becomes local (nothing leaves)', ai.aiState().tier === 'local');
  ok('leakage description says nothing leaves', /nothing leaves/i.test(ai.describeLeakage()));

  console.log('\ncomplete() verb');
  const txt = await ai.complete([{ role: 'user', content: 'say hi' }]);
  ok('returns model text', txt === 'hello');
  ok('sent the configured model', lastBody?.model === 'llama3.1');
  ok('did not stream', lastBody?.stream === false);

  console.log('\nJSON mode + loose parsing');
  globalThis.__mock = '```json\n{"title":"Q3 Report","keywords":["a","b"]}\n```';
  const j = await ai.complete([{ role: 'user', content: 'meta' }], { json: true });
  ok('parses JSON wrapped in code fences', j.title === 'Q3 Report' && Array.isArray(j.keywords));
  globalThis.__mock = 'Sure! Here it is: {"ok":true} hope that helps';
  const j2 = await ai.complete([{ role: 'user', content: 'x' }], { json: true });
  ok('extracts JSON embedded in prose', j2.ok === true);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('CRASH', e); process.exit(2); });
