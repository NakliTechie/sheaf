// test/history.mjs — the op-log + snapshot invariant (H1 regression): a session longer
// than MAX_STEPS must NEVER lose the replay floor. Before the fix, trimming dropped the
// -1 snapshot and re-seeded nothing, so getReplayPlan(-1).snap went null → replayFromFloor
// (the M0 gate) and undo both broke silently past ~80 ops.

import { History } from '../src/core/history.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

// Snapshot bytes encode N = number of ops applied to reach that pointer (little-endian).
const bytesFor = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const decode = (b) => b[0] | (b[1] << 8);

function main() {
  console.log('History — floor survives trimming past MAX_STEPS (H1)');
  const h = new History();
  h.saveSnapshot(-1, bytesFor(0)); // the origin floor (0 ops applied), as the runner seeds it

  // Drive it the way the runner does: push op i, then snapshot the tip with N = i+1 ops.
  for (let i = 0; i < 300; i++) {
    const p = h.push('op' + i, { i });
    h.saveSnapshot(p, bytesFor(i + 1));
  }

  const floorPlan = h.getReplayPlan(-1);
  ok('floor snapshot still exists after 300 ops', !!floorPlan.snap);
  ok('floor is at pointer -1', floorPlan.snap && floorPlan.snap.pointer === -1);

  const tip = h.pointer;
  const tipPlan = h.getReplayPlan(tip);
  ok('a reachable floor exists for the tip', !!tipPlan.snap && tipPlan.snap.pointer <= tip);
  ok('op log stayed bounded (<= 80)', h.size <= 80);

  // Continuity: floor bytes (N ops applied) + the surviving ops must exactly cover the
  // remaining global op indices with no gap or overlap.
  const N = decode(floorPlan.snap.bytes);
  const ops = h.opsUpToPointer();
  const idxs = ops.map(o => o.params.i);
  ok('surviving ops start exactly where the floor left off', idxs.length === 0 || idxs[0] === N);
  ok('surviving ops are contiguous and end at the last op (299)',
     idxs.length > 0 && idxs[idxs.length - 1] === 299 && idxs.every((v, k) => k === 0 || v === idxs[k - 1] + 1));

  console.log('\nUndo walk still resolves to a floored plan at every pointer');
  let allFloored = true;
  for (let p = h.pointer; p >= -1; p--) {
    const plan = h.getReplayPlan(p);
    if (!plan.snap || plan.snap.pointer > p) { allFloored = false; break; }
  }
  ok('every pointer down to -1 has a nearest snapshot (undo never orphans)', allFloored);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main();
