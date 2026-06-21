// history.js — the op-log + periodic snapshots that make replay possible.
//
// Sheaf's M0 gate: "event-log replay reconstructs state." State is the document.
// We log every committed op; we snapshot the serialized PDF bytes every N ops.
// To reach pointer P we load the nearest snapshot at/below P and re-run the ops
// after it. Undo/redo and crash-restore are the SAME walk — one mechanism.
//
// Same shape as Slate's history (suite convention); the snapshot payload is PDF
// bytes (Uint8Array) instead of an ImageData.

const MAX_STEPS = 80;
const SNAPSHOT_INTERVAL = 8;

export class History {
  constructor() {
    this._ops = [];      // [{ op, params }]
    this._snaps = [];    // [{ pointer, bytes }]   pointer -1 snap = the originally-opened bytes
    this._pointer = -1;  // -1 = original document, pre-any-op
  }

  // Record an op at the tip, truncating any redo branch. Returns the new pointer.
  push(op, params) {
    this._ops = this._ops.slice(0, this._pointer + 1);
    this._snaps = this._snaps.filter(s => s.pointer <= this._pointer);
    this._ops.push({ op, params });

    if (this._ops.length > MAX_STEPS) {
      const removed = this._ops.length - MAX_STEPS;
      this._ops = this._ops.slice(removed);
      this._snaps = this._snaps
        .filter(s => s.pointer >= removed)
        .map(s => ({ ...s, pointer: s.pointer - removed }));
      this._pointer = Math.max(-1, this._pointer - removed);
    }
    this._pointer = this._ops.length - 1;
    return this._pointer;
  }

  // Snapshot the document bytes at a pointer. The -1 (original) snapshot is always
  // kept regardless of interval — it's the replay floor. Others land on the interval.
  saveSnapshot(pointer, bytes) {
    if (pointer !== -1 && pointer % SNAPSHOT_INTERVAL !== 0) return;
    this._snaps = this._snaps.filter(s => s.pointer !== pointer);
    this._snaps.push({ pointer, bytes });
  }

  // The plan to reach targetPointer: the nearest snapshot at/below it + the ops
  // that must be re-run after that snapshot.
  getReplayPlan(targetPointer) {
    const snap = this._snaps
      .filter(s => s.pointer <= targetPointer)
      .sort((a, b) => b.pointer - a.pointer)[0] ?? null;
    const startPointer = snap ? snap.pointer : -1;
    const ops = this._ops.slice(startPointer + 1, targetPointer + 1);
    return { snap, ops };
  }

  // The full op log up to and including the current pointer (for export as a
  // re-runnable pipeline — the sovereign-artifact thesis, Bench §5).
  opsUpToPointer(pointer = this._pointer) {
    return this._ops.slice(0, pointer + 1).map(({ op, params }) => ({ op, params }));
  }

  canUndo() { return this._pointer >= 0; }
  canRedo() { return this._pointer < this._ops.length - 1; }
  stepBack() { if (!this.canUndo()) return false; this._pointer--; return true; }
  stepForward() { if (!this.canRedo()) return false; this._pointer++; return true; }

  get pointer() { return this._pointer; }
  get size() { return this._ops.length; }
  peek(pointer = this._pointer) { return this._ops[pointer] ?? null; }

  clear() { this._ops = []; this._snaps = []; this._pointer = -1; }
}
