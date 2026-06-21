// registry.js — THE operation registry. The spine of the whole tool.
//
// Every operation — page op, annotation, redaction, OCR, metadata edit — registers
// here once. Three doors dispatch through it (runner.dispatch): the human UI (click),
// the agent face (window.sheaf / URL mode — call), and the Bench conductor (brief).
// One mechanism, three entry points. This is what makes the agent face real and not
// a parallel codepath.
//
// An op definition:
//   {
//     id:            'pages.rotate'          // 'group.verb', stable, the agent vocabulary
//     label:         'Rotate pages'          // human label
//     group:         'page'                  // operation group (UI grouping + taxonomy)
//     icon:          'rotate'                // icon id (ui/icons)
//     description:   '…'                     // one line; the catalog the conductor reads
//     params:        { …schema }             // validated at the single ingress
//     mutates:       true                    // true → run returns { doc }; false → { artifact }
//     agentCallable: true                    // exposed on window.sheaf / URL mode?
//     run(doc, params) → { doc } | { artifact }
//   }

const _ops = new Map();

const GROUPS = [
  'open', 'page', 'annotate', 'text', 'forms', 'sign',
  'redact', 'ocr', 'compress', 'metadata', 'marks', 'convert', 'compare',
];

export function register(def) {
  if (!def || typeof def !== 'object') throw new Error('register() needs an op definition');
  const { id, run } = def;
  if (!id || typeof id !== 'string') throw new Error('op needs a string id');
  if (_ops.has(id)) throw new Error(`Duplicate op id: ${id}`);
  if (typeof run !== 'function') throw new Error(`op ${id} needs a run() function`);
  if (def.group && !GROUPS.includes(def.group)) throw new Error(`op ${id} has unknown group "${def.group}"`);
  _ops.set(id, {
    id,
    label: def.label || id,
    group: def.group || 'open',
    icon: def.icon || null,
    description: def.description || '',
    params: def.params || {},
    mutates: def.mutates !== false,        // default: a document-mutating op
    agentCallable: def.agentCallable === true,
    run,
  });
  return id;
}

export function registerAll(defs) { defs.forEach(register); }

export function get(id) { return _ops.get(id) || null; }
export function has(id) { return _ops.has(id); }
export function list({ group = null, agentCallableOnly = false } = {}) {
  let xs = [..._ops.values()];
  if (group) xs = xs.filter(o => o.group === group);
  if (agentCallableOnly) xs = xs.filter(o => o.agentCallable);
  return xs;
}
export function groups() { return GROUPS.slice(); }

// The machine-readable vocabulary handed to the agent face and the Bench conductor:
// op ids, their groups, descriptions, and param schemas — never document content.
export function catalog({ agentCallableOnly = true } = {}) {
  return list({ agentCallableOnly }).map(o => ({
    id: o.id, label: o.label, group: o.group, description: o.description,
    mutates: o.mutates, params: o.params,
  }));
}

// Test/hot-reload only.
export function _reset() { _ops.clear(); }
