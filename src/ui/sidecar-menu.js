// sidecar-menu.js — the AI entry point. Every action here STAGES: it produces a
// proposal the user reviews, then the deterministic registry op commits it. Cost is
// opt-in (you click it); consequence is opt-in (you confirm before it runs).

import { el } from './dom.js';
import { openModal, formModal, confirmModal } from './modal.js';
import { state } from '../core/state.js';
import { isAvailable, describeLeakage } from '../core/ai.js';
import { suggestMetadata, describeToRedact } from '../core/sidecar.js';
import { dispatch } from '../core/runner.js';
import { openAiSettings } from './ai-settings.js';
import { toast } from './toast.js';

export function openSidecarMenu() {
  if (!state.doc) return;
  const item = (label, desc, fn) => el('button', {
    class: 'btn', style: 'justify-content:flex-start;width:100%;text-align:left;height:auto;padding:10px 12px;flex-direction:column;align-items:flex-start;gap:2px',
    onClick: async () => { close(); await fn(); },
  }, [el('span', { text: label, style: 'font-size:14px' }), el('span', { text: desc, style: 'font-size:12px;color:var(--fg-faint)' })]);

  let close;
  const content = ({ close: c }) => { close = c; return el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    isAvailable()
      ? el('div', { text: describeLeakage(), style: 'font-size:12px;color:var(--ok);padding:2px 4px 6px' })
      : el('div', { html: 'No model configured — these stage proposals once you add one.', style: 'font-size:12px;color:var(--warn);padding:2px 4px 6px' }),
    item('Suggest metadata', 'Infer title/author/keywords from the text — review before applying', suggestMeta),
    item('Redact by description', 'Describe what to remove; find it locally, confirm, then true-redact', redactByDescription),
    el('hr', { style: 'border:none;border-top:1px solid var(--panel-border);margin:4px 0' }),
    item('Configure AI sidecar…', 'BYOK / local model · honest about what leaves', openAiSettings),
  ]); };
  return openModal({ title: 'AI sidecar', content, actions: [{ label: 'Close', value: true }] });
}

async function ensureAi() {
  if (isAvailable()) return true;
  if (await confirmModal('No AI model is configured. Set one up now?', { title: 'AI sidecar', okLabel: 'Configure' })) await openAiSettings();
  return isAvailable();
}

async function suggestMeta() {
  if (!await ensureAi()) return;
  let proposal;
  try { proposal = await withBusy('Reading the document…', () => suggestMetadata(state.doc)); }
  catch (e) { return toast('Suggestion failed', 'err', { detail: e.message }); }
  // STAGE: prefill the editable metadata form. Nothing commits until the user saves.
  const cur = state.doc.getMetadata();
  const v = await formModal('Suggested metadata (review)', [
    { name: 'title', label: 'Title', value: proposal.title || cur.title || '' },
    { name: 'author', label: 'Author', value: proposal.author || cur.author || '' },
    { name: 'subject', label: 'Subject', value: proposal.subject || cur.subject || '' },
    { name: 'keywords', label: 'Keywords', value: proposal.keywords || cur.keywords || '' },
  ], { okLabel: 'Apply' });
  if (v) { await dispatch('metadata.set', v); toast('Metadata applied', 'ok'); }
}

async function redactByDescription() {
  if (!await ensureAi()) return;
  const ask = await formModal('Redact by description', [{ name: 'description', label: 'What should be removed?', value: '' }], { okLabel: 'Find' });
  if (!ask?.description) return;
  let res;
  try { res = await withBusy('Finding matches locally…', () => describeToRedact(state.doc, ask.description)); }
  catch (e) { return toast('Could not analyze', 'err', { detail: e.message }); }
  if (!res.regions.length) return toast('No matching text found', 'warn', { detail: res.patterns.length ? `patterns: ${res.patterns.join(', ')}` : '' });

  // STAGE: show what would be removed; commit only on confirm.
  const sample = res.regions.slice(0, 8).map(r => `p${r.page + 1}: ${r.text.slice(0, 40)}`).join('\n');
  const ok = await confirmModal(`Found ${res.regions.length} match${res.regions.length > 1 ? 'es' : ''} to permanently redact:\n\n${sample}${res.regions.length > 8 ? '\n…' : ''}`, { title: 'Confirm redaction', okLabel: `Redact ${res.regions.length}`, danger: true });
  if (!ok) return;
  for (const r of res.regions) {
    // Pad the box slightly so the whole glyph run is covered.
    await dispatch('redact.region', { page: r.page, x: Math.max(0, r.x - 0.005), y: Math.max(0, r.y - 0.004), w: Math.min(1, r.w + 0.01), h: Math.min(1, r.h + 0.008) });
  }
  toast(`Redacted ${res.regions.length} region${res.regions.length > 1 ? 's' : ''}`, 'ok');
}

// Minimal busy overlay during a model call.
async function withBusy(message, fn) {
  const note = el('div', { text: message, style: 'position:fixed;bottom:46px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--panel-border);padding:8px 14px;border-radius:9px;z-index:70;box-shadow:var(--shadow-pop)' });
  document.body.appendChild(note);
  try { return await fn(); } finally { note.remove(); }
}
