// sidecar.js — the AI sidecar surfaces. Each rides a REAL Sheaf surface, sends only
// the minimum slice the task needs, and returns a STAGED proposal — it never commits.
// The proposal is executed (or not) through the deterministic registry ops, so the AI
// is a removable passenger: remove this file and metadata/redaction still work by hand.
//
// Cost is opt-in (these run only on an explicit user action). Consequence is opt-in
// (callers stage the result and let the user confirm before dispatching the op).

import { complete, isAvailable } from './ai.js';
import { openForRender } from './render.js';

// Text items with normalized (0..1, top-left) boxes — for redaction targeting.
async function pageTextItems(pdf, pageIndex) {
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const tc = await page.getTextContent();
  return tc.items.filter(it => it.str?.trim()).map(it => {
    const [, b, , d, e, f] = it.transform;
    const h = it.height || Math.hypot(b, d) || 10;
    return { str: it.str, x: e / W, y: (H - (f + h)) / H, w: (it.width || 0) / W, h: h / H };
  });
}

// suggest-metadata — infer title/author/subject/keywords from a SLICE of the text.
// The slice (not the whole document) is what leaves, to the user's own provider.
export async function suggestMetadata(doc) {
  if (!isAvailable()) throw new Error('No model configured');
  const pdf = await openForRender(await doc.toBytes());
  let text = '';
  for (let i = 0; i < Math.min(pdf.numPages, 2); i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent();
    text += tc.items.map(x => x.str).join(' ') + '\n';
  }
  pdf.destroy?.();
  text = text.replace(/\s+/g, ' ').slice(0, 4000); // minimum slice
  if (!text.trim()) throw new Error('No extractable text (a scanned PDF needs OCR first)');
  const out = await complete([
    { role: 'user', content: `Infer concise document metadata from this text. Return JSON {"title","author","subject","keywords"} — keywords comma-separated, empty string when unknown.\n\n${text}` },
  ], { json: true });
  return {
    title: out.title || '', author: out.author || '', subject: out.subject || '',
    keywords: Array.isArray(out.keywords) ? out.keywords.join(', ') : (out.keywords || ''),
  };
}

// describe-to-redact — the model only sees the DESCRIPTION ("account numbers"), turns it
// into regex patterns; positions are found LOCALLY via PDF.js. The document's text never
// leaves the machine for this. Returns proposed redaction regions to STAGE for review.
export async function describeToRedact(doc, description) {
  if (!isAvailable()) throw new Error('No model configured');
  const out = await complete([
    { role: 'user', content: `The user wants to redact: "${description}". Return JSON {"patterns":["<regex source>", ...]} — JavaScript regular-expression sources (no slashes, no flags) that match such text. Be precise; prefer specific patterns over broad ones.` },
  ], { json: true });
  const sources = Array.isArray(out.patterns) ? out.patterns : [];
  const patterns = sources.map(p => { try { return new RegExp(p, 'gi'); } catch { return null; } }).filter(Boolean);
  if (!patterns.length) return { regions: [], patterns: sources };

  const pdf = await openForRender(await doc.toBytes());
  const regions = [];
  for (let i = 0; i < pdf.numPages; i++) {
    for (const it of await pageTextItems(pdf, i)) {
      for (const re of patterns) { re.lastIndex = 0; if (re.test(it.str)) { regions.push({ page: i, x: it.x, y: it.y, w: it.w, h: it.h, text: it.str }); break; } }
    }
  }
  pdf.destroy?.();
  return { regions, patterns: sources };
}
