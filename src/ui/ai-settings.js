// ai-settings.js — configure the AI sidecar. The ladder is detected, not picked: a
// local Ollama/LM Studio is found automatically; the only thing to configure is BYOK
// (your own provider + key). Honest about where data goes. Off until configured —
// the whole tool works with nothing here.

import { el } from './dom.js';
import { openModal, confirmModal } from './modal.js';
import { aiState, describeLeakage, configureByok, disableByok, detectLocal, init } from '../core/ai.js';
import { getAiConfig } from '../core/storage.js';
import { toast } from './toast.js';

export async function openAiSettings() {
  await init().catch(() => {});
  const cfg = await getAiConfig().catch(() => null);
  const s = aiState();

  const content = ({ close }) => {
    const endpoint = el('input', { type: 'url', value: cfg?.endpoint || '', placeholder: 'https://api.openai.com/v1/chat/completions' });
    const model = el('input', { type: 'text', value: cfg?.model || '', placeholder: 'gpt-4o-mini  ·  llama3.1  ·  …' });
    const key = el('input', { type: 'password', value: '', placeholder: cfg?.keyFingerprint ? `saved (fp ${cfg.keyFingerprint})` : 'sk-…  (stays on this device)' });

    return el('div', { style: 'display:flex;flex-direction:column;gap:14px' }, [
      el('div', { style: 'font-size:13px;padding:8px 10px;border-radius:8px;background:var(--bg-sunken)' }, [
        el('div', { html: `<b>Active:</b> ${s.tier === 'none' ? 'no model (AI features off)' : s.tier}` }),
        el('div', { text: describeLeakage(), style: 'color:var(--fg-muted);margin-top:4px;font-size:12px' }),
        s.local ? null : el('div', { text: 'Tip: run Ollama or LM Studio locally and it’s detected automatically — nothing leaves your machine.', style: 'color:var(--fg-faint);margin-top:4px;font-size:12px' }),
      ]),
      el('div', { text: 'Bring your own key (any OpenAI-compatible endpoint)', style: 'font-size:13px;color:var(--fg-muted)' }),
      el('label', {}, ['Endpoint', endpoint]),
      el('label', {}, ['Model', model]),
      el('label', {}, ['API key', key]),
      el('div', { style: 'font-size:12px;color:var(--fg-faint);line-height:1.5', html: 'Your key is stored only in this browser’s local database and sent <b>only</b> to the endpoint you enter — never to us (there is no “us”; this is a single static file). Pull the AI out entirely and every Sheaf tool still works.' }),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('button', { class: 'btn primary', onClick: async () => {
          try { await configureByok({ endpoint: endpoint.value, model: model.value, apiKey: key.value || (cfg?.apiKey || '') }); toast('AI sidecar configured', 'ok'); close(true); }
          catch (e) { toast('Could not save', 'err', { detail: e.message }); }
        } }, ['Save']),
        cfg ? el('button', { class: 'btn danger', onClick: async () => { if (await confirmModal('Remove the saved provider + key from this device?', { title: 'Disable AI', okLabel: 'Remove', danger: true })) { await disableByok(); toast('AI disabled', 'ok'); close(true); } } }, ['Disable']) : null,
        el('button', { class: 'btn', onClick: async () => { const l = await detectLocal(); toast(l ? `Found ${l.name}` : 'No local model detected', l ? 'ok' : 'warn'); } }, ['Re-detect local']),
      ]),
    ]);
  };

  return openModal({ title: 'AI sidecar', content, actions: [{ label: 'Close', value: true }] });
}
