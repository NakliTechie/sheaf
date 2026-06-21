// keyboard.js — KeyboardGrammar (nakli-creative-primitives convention). Register
// combos with a context; the dispatcher resolves which binding wins. The suite
// shares this so every tool's shortcuts read the same way.
//
// THE S-COLLISION, RESOLVED (handoff §12): "save" and "strike" both want S.
//   • mod+s  → Save        — context 'global', always wins (has a modifier).
//   • s      → Strike tool — context 'viewer', bare key, fires ONLY when a viewer
//                            has focus and the user is not typing in a field.
// A modifier'd combo and a bare key never collide because they normalize to
// different strings ('mod+s' vs 's'). The remaining risk — a bare 's' captured
// while typing — is removed by the editable-target guard below.

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Normalize a KeyboardEvent to a combo string: '[mod+][shift+][alt+]key'.
// mod = Cmd on macOS, Ctrl elsewhere.
function comboOf(ev) {
  const parts = [];
  if (ev.metaKey || ev.ctrlKey) parts.push('mod');
  if (ev.shiftKey) parts.push('shift');
  if (ev.altKey) parts.push('alt');
  let k = ev.key;
  if (k === ' ') k = 'space';
  else if (k.length === 1) k = k.toLowerCase();
  else k = k.toLowerCase(); // 'ArrowDown' -> 'arrowdown', 'Escape' -> 'escape'
  parts.push(k);
  return parts.join('+');
}

export class KeyboardGrammar {
  constructor() {
    this._bindings = new Map();    // combo -> [{ handler, context, when, label }]
    this._contextResolver = () => ['global'];
    this._enabled = true;
  }

  // contextResolver returns the active contexts, most-specific first. A binding
  // matches if its context is active. 'global' bindings are the fallback.
  setContextResolver(fn) { this._contextResolver = fn; }
  enable(v = true) { this._enabled = v; }

  register(combo, handler, { context = 'global', when = null, label = '', description = '' } = {}) {
    const norm = combo.toLowerCase();
    if (!this._bindings.has(norm)) this._bindings.set(norm, []);
    this._bindings.get(norm).push({ handler, context, when, label, description });
    return this;
  }

  // The list for a help panel (suite /guide reads this).
  list() {
    const out = [];
    for (const [combo, binds] of this._bindings) for (const b of binds) out.push({ combo, ...b });
    return out;
  }

  attach(target = window) {
    target.addEventListener('keydown', (ev) => this._onKey(ev));
    return this;
  }

  _onKey(ev) {
    if (!this._enabled) return;
    const combo = comboOf(ev);
    const binds = this._bindings.get(combo);
    if (!binds || !binds.length) return;

    const hasModifier = ev.metaKey || ev.ctrlKey;
    // Bare keys must not fire while typing.
    if (!hasModifier && isEditable(ev.target)) return;

    const active = this._contextResolver();
    const order = [...active, 'global'];
    // Pick the most-specific active context that has a matching binding whose
    // `when` predicate (if any) passes.
    for (const ctx of order) {
      const match = binds.find(b => b.context === ctx && (!b.when || b.when(ev)));
      if (match) {
        ev.preventDefault();
        match.handler(ev);
        return;
      }
    }
  }
}

export const keyboard = new KeyboardGrammar();
