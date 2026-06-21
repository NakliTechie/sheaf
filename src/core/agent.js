// agent.js — the agent face. `window.sheaf` + URL mode, both dispatching through
// the SAME runner.dispatch as the human UI. One core, two doors (the third, the
// Bench conductor, drives this same surface). Off by default — opt-in developer
// setting — so a random page load or link can never drive someone's document.
//
// What the agent face may see: the operation catalog and minimal document context
// (page geometry, metadata, field list) — NEVER page content, extracted text, or
// form values. The document stays put; the registry executes locally on the full file.

import { state } from './state.js';
import { dispatch, exportPipeline, undo, redo, historyStatus } from './runner.js';
import { get as getOp, catalog } from './registry.js';
import { emit } from './events.js';
import { loadEngine, isLoaded } from './engines.js';

function requireAgentCallable(id) {
  const op = getOp(id);
  if (!op) throw new Error(`Unknown operation: ${id}`);
  if (!op.agentCallable) throw new Error(`Operation "${id}" is not agent-callable`);
  return op;
}

// window.sheaf must be self-sufficient — an agent driving it shouldn't have to
// preload engines the way the UI does. Ensure the core write engine before any op.
async function ensureCoreEngine() {
  if (!isLoaded('pdf-lib')) await loadEngine('pdf-lib');
}

// Minimal, content-free document context — the conductor's view.
function docContext() {
  if (!state.doc) return { open: false };
  return {
    open: true,
    fileName: state.session.fileName,
    pageCount: state.doc.pageCount(),
    pages: state.doc.pages(),       // geometry only: {index,width,height,rotation}
    metadata: state.doc.getMetadata(),
    dirty: state.dirty,
    history: historyStatus(),
  };
}

function buildApi() {
  return Object.freeze({
    version: 1,
    // The vocabulary: agent-callable ops, their params, descriptions.
    ops: () => catalog({ agentCallableOnly: true }),
    // Minimal context — never content.
    context: () => docContext(),
    // Drive an op through the one runner. Agent-callable ops only.
    run: async (id, params = {}) => {
      requireAgentCallable(id);
      await ensureCoreEngine();
      return dispatch(id, params, { source: 'agent' });
    },
    undo, redo,
    // Export the current document bytes (the user's own file) or the op-log as a
    // sovereign, model-free pipeline.
    bytes: async () => (state.doc ? state.doc.toBytes() : null),
    pipeline: () => exportPipeline(),
    // Replay a saved pipeline against the current document.
    runPipeline: async (pipe) => {
      if (!pipe || pipe.tool !== 'sheaf' || !Array.isArray(pipe.ops)) throw new Error('Not a Sheaf pipeline');
      await ensureCoreEngine();
      const results = [];
      for (const { op, params } of pipe.ops) {
        requireAgentCallable(op);
        results.push(await dispatch(op, params, { source: 'agent' }));
      }
      return results;
    },
  });
}

// Install / remove window.sheaf based on the developer setting.
export function refreshAgentFace() {
  if (typeof window === 'undefined') return;
  if (state.dev.agentFace) {
    window.sheaf = buildApi();
    emit('agent:enabled', null);
  } else if (window.sheaf) {
    delete window.sheaf;
    emit('agent:disabled', null);
  }
}

export function setAgentFace(on) {
  state.dev.agentFace = !!on;
  emit('prefs:save', null);
  refreshAgentFace();
}

// URL mode: ?op=<id>&p.<name>=<value>&format=json — headless invocation that also
// makes the tool testable. Gated behind the same developer setting; a link cannot
// silently run ops on someone's machine.
export async function handleUrlMode() {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  const opId = q.get('op');
  if (!opId) return false;
  if (!state.dev.agentFace) {
    console.warn('[sheaf] URL op ignored — agent face is off. Enable it in settings to allow headless ops.');
    return false;
  }
  const params = {};
  for (const [k, v] of q) {
    if (k.startsWith('p.')) {
      try { params[k.slice(2)] = JSON.parse(v); } catch { params[k.slice(2)] = v; }
    }
  }
  try {
    requireAgentCallable(opId);
    await ensureCoreEngine();
    const res = await dispatch(opId, params, { source: 'url' });
    if (q.get('format') === 'json') {
      document.documentElement.dataset.sheafResult = JSON.stringify({ ok: true, context: docContext() });
    }
    return res;
  } catch (err) {
    console.error('[sheaf] URL op failed:', err.message);
    if (q.get('format') === 'json') document.documentElement.dataset.sheafResult = JSON.stringify({ ok: false, error: err.message });
    return false;
  }
}
