// events.js — the suite event bus (nakli-creative-primitives convention).
// A tiny synchronous pub/sub. One bus per tab; modules talk through topics, never
// by reaching into each other. Lifted from the shared primitive so tools 2–5 see
// the same shape.

const _bus = new Map();

export function on(type, fn) {
  if (!_bus.has(type)) _bus.set(type, new Set());
  _bus.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  _bus.get(type)?.delete(fn);
}

export function once(type, fn) {
  const wrapper = (data) => { off(type, wrapper); fn(data); };
  on(type, wrapper);
}

export function emit(type, data) {
  // Copy the listener set so a handler that subscribes/unsubscribes mid-emit
  // doesn't corrupt the iteration.
  const set = _bus.get(type);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(data); }
    catch (err) { console.error(`[events] handler for "${type}" threw:`, err); }
  }
}
