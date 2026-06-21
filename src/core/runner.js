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

  const result = await op.run(state.doc, clean);

  if (!op.mutates) {
    // Artifact op — no document change, nothing recorded.
    emit('op:artifact', { id, source });
    return { ok: true, artifact: result?.artifact ?? null };
  }

  const newDoc = result?.doc;
  if (!(newDoc instanceof SheafDoc)) throw new Error(`Op "${id}" must return { doc } but did not`);
  state.doc = newDoc;

  if (op.group === 'open') {
    // A fresh document: reset history, seed the floor with these bytes.
    seedFloor(await newDoc.toBytes());
    markDirty(false);
    emit('doc:changed', { id, source, opened: true });
    return { ok: true, doc: newDoc };
  }

  if (record) await commitOp(id, clean);
  markDirty(true);
  emit('doc:changed', { id, source });
  return { ok: true, doc: newDoc };
}

async function commitOp(id, params) {
  const pointer = state.history.push(id, params);
  // Snapshot the serialized document at snapshot points (and the floor). Replay
  // between snapshots re-runs only the ops since the nearest one.
  const bytes = await state.doc.toBytes();
  state.history.saveSnapshot(pointer, bytes);
  emit('history:changed', historyStatus());
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
    const res = await def.run(doc, params);
    doc = res.doc;
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
    const res = await def.run(doc, params);
    doc = res.doc;
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
