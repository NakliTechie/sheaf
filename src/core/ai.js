// ai.js — the nakli-ai primitive (Edge-First inference). Sheaf reaches a model ONLY
// through here; no surface POSTs to a provider directly. Built inside Sheaf for now
// (no shared package exists yet) but shaped to lift into the suite primitive: a clean
// ladder + a single complete() verb.
//
// THE LADDER (Edge-First, detected-not-configured):
//   1. local bridge   — Ollama / LM Studio on localhost (OpenAI-compatible). Detected.
//   2. WebGPU         — Transformers.js in-tab. (structured; lazy, opt-in download)
//   3. BYOK           — the user's own provider + key (VaultMind: key local, never to
//                       us, fingerprint shown). The realistic default.
//   4. relay          — sovereign zero-retention relay. (structured; not wired in v1.0)
//
// HONESTY: local tiers → nothing leaves the machine. BYOK → only the minimum slice the
// task needs leaves, to the USER'S provider, never to us. describeLeakage() surfaces
// which, so the UI can be honest, not blurred.
//
// COST/CONSEQUENCE: complete() runs only on an explicit user action (the surfaces gate
// it); it never auto-commits — every result is a staged proposal the deterministic core
// gates. Pull this module out and every Sheaf operation still works (the no-AI floor).

import { getAiConfig, saveAiConfig, clearAiConfig } from './storage.js';
import { emit } from './events.js';

const LOCAL_PROBES = [
  { id: 'ollama', name: 'Ollama', base: 'http://localhost:11434', models: '/v1/models', chat: '/v1/chat/completions' },
  { id: 'lmstudio', name: 'LM Studio', base: 'http://localhost:1234', models: '/v1/models', chat: '/v1/chat/completions' },
];

const _state = {
  local: null,        // detected local bridge descriptor, or null
  byok: null,         // { endpoint, model, keyFingerprint } (key itself lives in storage)
  tier: 'none',       // 'local' | 'byok' | 'none'
};

// Injectable for tests; defaults to global fetch.
let _fetch = (typeof fetch !== 'undefined') ? ((...a) => fetch(...a)) : null;
export function _setFetch(fn) { _fetch = fn; }

export function aiState() { return { tier: _state.tier, local: _state.local?.name || null, byok: _state.byok ? { endpoint: _state.byok.endpoint, model: _state.byok.model, fingerprint: _state.byok.keyFingerprint } : null }; }
export function isAvailable() { return _state.tier !== 'none'; }

// Honest one-liner about where data goes for the active tier.
export function describeLeakage() {
  if (_state.tier === 'local') return `Local model (${_state.local.name}) — nothing leaves this machine.`;
  if (_state.tier === 'byok') return `Your provider (${hostOf(_state.byok.endpoint)}) — only the minimum text the task needs is sent, to your own key. Never to us.`;
  return 'No model configured — AI features are off.';
}

function hostOf(url) { try { return new URL(url).host; } catch { return url; } }

async function fingerprint(key) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return [...new Uint8Array(buf)].slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return key.slice(0, 4) + '…'; }
}

// Probe localhost bridges (cheap, fails fast/quiet). Detected, not configured.
export async function detectLocal({ timeoutMs = 800 } = {}) {
  for (const p of LOCAL_PROBES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await _fetch(p.base + p.models, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const model = data?.data?.[0]?.id || 'local';
        _state.local = { ...p, model };
        _state.tier = 'local';   // local wins the ladder — nothing leaves the machine
        emit('ai:changed', aiState());
        return _state.local;
      }
    } catch { /* not present — quiet */ }
  }
  _state.local = null;
  if (_state.tier === 'local') _state.tier = _state.byok ? 'byok' : 'none';
  return null;
}

// Load any saved BYOK config. NETWORK-FREE on purpose: it must NOT probe localhost
// here. A page that fetches http://localhost on load trips Chrome's "access devices on
// your local network" permission prompt — hostile, unprompted, on open. Local
// detection is deferred to the moment the user actually engages AI and needs a model
// (ensureLocal / the AI settings "detect" button) — sought only when required.
export async function init() {
  const cfg = await getAiConfig().catch(() => null);
  if (cfg?.endpoint && cfg?.model) _state.byok = { endpoint: cfg.endpoint, model: cfg.model, keyFingerprint: cfg.keyFingerprint || '' };
  _state.tier = _state.byok ? 'byok' : 'none';
  emit('ai:changed', aiState());
  return aiState();
}

// Opportunistically detect a local model ONLY when the user is already engaging AI and
// no provider is active yet (e.g. they invoked a sidecar surface with nothing
// configured). This is the one place a boot-clean app may touch localhost — and only
// behind an explicit AI action. Returns true if a local model is now available.
export async function ensureLocal() {
  if (_state.tier !== 'none') return _state.tier === 'local';
  await detectLocal().catch(() => {});
  return _state.tier === 'local';
}

export async function configureByok({ endpoint, model, apiKey }) {
  if (!endpoint || !model) throw new Error('Endpoint and model are required');
  const keyFingerprint = apiKey ? await fingerprint(apiKey) : '';
  await saveAiConfig({ endpoint: endpoint.trim(), model: model.trim(), apiKey: apiKey || '', keyFingerprint });
  _state.byok = { endpoint: endpoint.trim(), model: model.trim(), keyFingerprint };
  if (_state.tier !== 'local') _state.tier = 'byok';
  emit('ai:changed', aiState());
}

export async function disableByok() { await clearAiConfig(); _state.byok = null; _state.tier = _state.local ? 'local' : 'none'; emit('ai:changed', aiState()); }

// The one verb. messages = [{role, content}]. opts.json → ask for + parse JSON.
// Throws if no tier is available (callers must check isAvailable first / the no-AI
// surface stays usable without ever calling this).
export async function complete(messages, { json = false, maxTokens = 700, temperature = 0.2 } = {}) {
  if (_state.tier === 'none') throw new Error('No model configured');
  const sys = json ? { role: 'system', content: 'Respond with ONLY valid minified JSON, no prose, no code fences.' } : null;
  const body = { model: activeModel(), messages: sys ? [sys, ...messages] : messages, temperature, max_tokens: maxTokens, stream: false };

  let url, headers = { 'Content-Type': 'application/json' };
  if (_state.tier === 'local') { url = _state.local.base + _state.local.chat; }
  else {
    url = _state.byok.endpoint;
    const cfg = await getAiConfig();
    if (cfg?.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  }

  const res = await _fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Model error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!json) return text;
  return parseJsonLoose(text);
}

function activeModel() { return _state.tier === 'local' ? _state.local.model : _state.byok.model; }

// Models sometimes wrap JSON in prose/fences despite instruction — extract robustly.
function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const span = text.match(/[[{][\s\S]*[\]}]/);
  if (span) { try { return JSON.parse(span[0]); } catch {} }
  throw new Error('Model did not return valid JSON');
}
