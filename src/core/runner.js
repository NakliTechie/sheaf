// runner.js — the dispatch + replay engine. The single path every operation takes,
// no matter which door it came through (UI click, window.sheaf call, conductor brief).
//
//   dispatch(id, params, {source})  validate params → run op → install result → log
//   undo() / redo()                 walk the op-log via nearest snapshot
//   replayFromFloor()               re-run the WHOLE log from the origin (the M0 gate)
//   exportPipeline()                the op-log as a re-runnable, model-free artifact
//
// Document-mutating ops return { doc }; artifact ops (convert, extract) return
// { artifact } and are not recorded — they don't change document state.

import { state, markDirty } from './state.js';
import { get as getOp } from './registry.js';
import { validateParams } from './schema.js';
import { SheafDoc } from './doc.js';
import { emit } from './events.js';

// Seed the replay floor when a document opens. The -1 snapshot is the bytes the
// user opened; every replay starts here. Open ops call this, not the op-log.
export function seedFloor(openedBytes) {
  state.history.clear();
  state.history.saveSnapshot(-1, openedBytes);
  emit('history:changed', historyStatus());
}

export async function dispatch(id, params = {}, { source = 'ui', record = true } = {}) {
  const op = getOp(id);
  if (!op) throw new Error(`Unknown operation: ${id}`);

  // The single ingress: coerce + validate params before the op sees them.
  const clean = validateParams(op.params, params);

  // Open ops may run with no current doc; everything else needs one.
  if (op.group !== 'open' && !state.doc) throw new Error(`No document open for "${id}"`);

  if (op.group !== 'open') {
    // Mutating/artifact op on the current doc. runAndNormalize re-parses the result
    // from its own bytes so getPages()/getPageCount()/metadata are always consistent
    // (pdf-lib's getPages() cache can go stale after in-place removePage/insertPage)
    // and so the in-memory doc, the snapshot, and what the renderer derives are the
    // same byte representation. Costs one re-parse per op — correctness over micro-perf.
    const r = await runAndNormalize(state.doc, op, clean);
    if ('artifact' in r) { emit('op:artifact', { id, source }); return { ok: true, artifact: r.artifact }; }
    state.doc = r.doc;
    if (record) {
      const pointer = state.history.push(id, clean);
      state.history.saveSnapshot(pointer, r.bytes);
      emit('history:changed', historyStatus());
    }
    markDirty(true);
    emit('doc:changed', { id, source });
    return { ok: true, doc: r.doc };
  }

  // Open op: a fresh document. Reset history + view + selection, seed the floor.
  const newDoc = result_open(await op.run(state.doc, clean), id);
  state.doc = await newDoc;
  seedFloor(await state.doc.toBytes());
  state.view.pageIndex = 0;
  state.selection = { pages: [], region: null };
  state.activeTool = null;
  markDirty(false);
  emit('doc:loaded', { id, source, pageCount: state.doc.pageCount() });
  return { ok: true, doc: state.doc };
}

// Helper: validate an open op's result is a doc.
function result_open(result, id) {
  const d = result?.doc;
  if (!(d instanceof SheafDoc)) throw new Error(`Open op "${id}" must return { doc }`);
  return d;
}

// Run an op and, if it mutates, normalize the result through its bytes. Returns
// { doc, bytes } for mutating ops or { artifact } for artifact ops. The single place
// ops are executed against a doc — dispatch and replay both go through it, so the live
// path and the replay path are byte-for-byte identical.
async function runAndNormalize(doc, op, params) {
  const res = await op.run(doc, params);
  if (op.mutates === false) return { artifact: res?.artifact ?? null };
  const out = res?.doc;
  if (!(out instanceof SheafDoc)) throw new Error(`Op "${op.id}" must return { doc } but did not`);
  const bytes = await out.toBytes();
  return { doc: await SheafDoc.fromBytes(bytes, { validate: false }), bytes };
}

// Rebuild the document at a target pointer from the nearest snapshot + replayed ops.
// Shared by undo and redo.
async function applyToPointer(target) {
  const { snap, ops } = state.history.getReplayPlan(target);
  if (!snap) throw new Error('No snapshot floor — document was not opened through the runner');
  let doc = await SheafDoc.fromBytes(snap.bytes, { validate: false });
  for (const { op, params } of ops) {
    const def = getOp(op);
    if (!def) throw new Error(`Replay hit unknown op "${op}"`);
    doc = (await runAndNormalize(doc, def, params)).doc;
  }
  state.doc = doc;
  emit('doc:changed', { replay: true });
}

export async function undo() {
  if (!state.history.canUndo()) return false;
  state.history.stepBack();
  await applyToPointer(state.history.pointer);
  markDirty(state.history.pointer >= 0);
  emit('history:changed', historyStatus());
  return true;
}

export async function redo() {
  if (!state.history.canRedo()) return false;
  state.history.stepForward();
  await applyToPointer(state.history.pointer);
  markDirty(true);
  emit('history:changed', historyStatus());
  return true;
}

// The M0 gate: replay the ENTIRE op-log from the origin (ignoring mid snapshots) and
// return the reconstructed document. If its fingerprint equals the live document's,
// the event log fully reconstructs state.
export async function replayFromFloor() {
  const floor = state.history.getReplayPlan(-1).snap;
  if (!floor) throw new Error('No floor snapshot to replay from');
  let doc = await SheafDoc.fromBytes(floor.bytes, { validate: false });
  for (const { op, params } of state.history.opsUpToPointer()) {
    const def = getOp(op);
    doc = (await runAndNormalize(doc, def, params)).doc;
  }
  return doc;
}

// The op-log as a sovereign, re-runnable pipeline (Bench §5). No model needed to
// replay — the ops are deterministic registry calls.
export function exportPipeline() {
  return {
    tool: 'sheaf',
    version: 1,
    ops: state.history.opsUpToPointer(),
  };
}

export function historyStatus() {
  return {
    canUndo: state.history.canUndo(),
    canRedo: state.history.canRedo(),
    size: state.history.size,
    pointer: state.history.pointer,
  };
}
