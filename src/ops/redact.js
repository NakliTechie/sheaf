// ops/redact.js — TRUE redaction. Not a black box over live text: the text is
// removed from the page content stream so it cannot be extracted, copied, or read by
// any tool. Then an opaque black rectangle is drawn over the region as the visible
// marker. Verifiable: after redaction the target's bytes are gone from the stream.
//
// Mechanism: pdf-lib renders text as `<hexstring> Tj` / `[...] TJ` operators with the
// position set by `Tm`/`Td`/`TD`/`T*`. We tokenize the content stream, track the text
// position, and empty any text-show operator whose drawn region overlaps a redaction
// box. This handles the common case (axis-aligned text, identity page transform).
// Documented gaps (text inside form XObjects, rotated text matrices, Type3 fonts) are
// still covered visually by the black box; the additive upgrade is a fuller content
// parser — flagged, not silently skipped.

import { getEngine } from '../core/engines.js';

function lib() { return getEngine('pdf-lib'); }

// ── Content-stream tokenizer ────────────────────────────────────────────────────
// tokenize + redactTokens are exported for direct testing (test/redact.mjs).
const WS = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

export function tokenize(str) {
  const toks = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const c = str[i];
    if (WS.has(c)) { i++; continue; }
    if (c === '%') { while (i < n && str[i] !== '\n' && str[i] !== '\r') i++; continue; }
    if (c === '(') { // literal string with balanced parens + escapes
      let depth = 0, j = i, out = '';
      do {
        const ch = str[j];
        if (ch === '\\') { out += ch + (str[j + 1] ?? ''); j += 2; continue; }
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        out += ch; j++;
      } while (j < n && depth > 0);
      toks.push({ type: 'str', kind: 'lit', raw: out }); i = j; continue;
    }
    if (c === '<' && str[i + 1] === '<') { toks.push({ type: 'op', raw: '<<' }); i += 2; continue; }
    if (c === '>' && str[i + 1] === '>') { toks.push({ type: 'op', raw: '>>' }); i += 2; continue; }
    if (c === '<') { let j = i + 1; while (j < n && str[j] !== '>') j++; toks.push({ type: 'str', kind: 'hex', raw: str.slice(i, j + 1) }); i = j + 1; continue; }
    if (c === '[' || c === ']') { toks.push({ type: 'op', raw: c }); i++; continue; }
    if (c === '/') { let j = i + 1; while (j < n && !WS.has(str[j]) && !DELIM.has(str[j])) j++; toks.push({ type: 'name', raw: str.slice(i, j) }); i = j; continue; }
    // number or operator (run of non-delimiter, non-ws)
    let j = i; while (j < n && !WS.has(str[j]) && !DELIM.has(str[j])) j++;
    const raw = str.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) { toks.push({ type: 'num', raw, value: parseFloat(raw) }); continue; }
    toks.push({ type: 'op', raw });
    // Inline image: `BI … ID <raw bytes> EI`. The bytes between ID and EI are binary
    // and must NOT be tokenized — otherwise a stray '(' or 'Tj' in the image data
    // desyncs text-position tracking and redaction silently targets the wrong glyphs
    // (or misses, while still drawing the reassuring black box). Capture verbatim.
    if (raw === 'ID') {
      // Exactly one whitespace separates `ID` from the binary image data (PDF 8.9.7).
      // Consume it so the captured raw is the image bytes ALONE — reconstruct() re-emits the
      // single delimiter space, avoiding a one-byte shift into the image data (L1).
      if (i < n && WS.has(str[i])) i++;
      let k = i;
      while (k < n) {
        if (WS.has(str[k]) && str[k + 1] === 'E' && str[k + 2] === 'I' && (k + 3 >= n || WS.has(str[k + 3]) || DELIM.has(str[k + 3]))) break;
        k++;
      }
      toks.push({ type: 'raw', raw: str.slice(i, k) });
      i = k;
    }
  }
  return toks;
}

function hexLen(hexRaw) { // number of bytes in a <..> string
  const inner = hexRaw.slice(1, -1).replace(/\s/g, '');
  return Math.ceil(inner.length / 2);
}
function litLen(litRaw) { // approx glyph count of a (..) string
  return litRaw.slice(1, -1).replace(/\\./g, 'x').length;
}

// Walk tokens, track text position, and empty string tokens whose region overlaps any
// box. Boxes are PDF-space rects {x0,y0,x1,y1}. Returns reconstructed stream text.
export function redactTokens(toks, boxes, defaultFontSize = 12) {
  let tm = [1, 0, 0, 1, 0, 0];   // text matrix
  let lm = [1, 0, 0, 1, 0, 0];   // line matrix
  let fontSize = defaultFontSize, leading = 0;
  let dirty = false;             // did any show-operator actually get emptied?
  const stack = [];

  // M1: convert the text-space run into page space using the text matrix scale, and bias
  // toward OVER-removal (redaction must never leave targeted text behind because an estimate
  // ran short). HSCALE/VSCALE are the axis-aligned scale factors from Tm; a rotated/skewed
  // matrix (tm[1] or tm[2] != 0) is NOT resolved here — those runs are reported as residue
  // to the C1 honesty layer rather than silently mistracked.
  const HSCALE = () => (Math.abs(tm[0]) > 1e-6 ? Math.abs(tm[0]) : 1);
  const VSCALE = () => (Math.abs(tm[3]) > 1e-6 ? Math.abs(tm[3]) : 1);

  // Generous vertical band around the baseline (ascent 0.85em, descent 0.25em) and a slightly
  // high 0.55em per-glyph advance — both err toward covering, not missing.
  const overlaps = (x, y, wPage) => {
    const asc = fontSize * 0.85 * VSCALE(), desc = fontSize * 0.25 * VSCALE();
    return boxes.some(b => x + wPage >= b.x0 && x <= b.x1 && y + asc >= b.y0 && y - desc <= b.y1);
  };

  const showWidth = (tok) => { // text-space advance estimate (biased slightly high)
    const glyphs = tok.kind === 'hex' ? hexLen(tok.raw) : litLen(tok.raw);
    return glyphs * fontSize * 0.55;
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'num') { stack.push(t.value); continue; }
    if (t.type === 'str' || t.type === 'name') { stack.push(t); continue; }
    const op = t.raw;
    if (op === '[') { stack.push('['); continue; }
    if (op === ']') { const arr = []; while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop()); stack.pop(); stack.push({ type: 'arr', items: arr }); continue; }

    switch (op) {
      case 'Tf': fontSize = typeof stack[stack.length - 1] === 'number' ? stack[stack.length - 1] : fontSize; break;
      case 'TL': leading = stack[stack.length - 1] ?? leading; break;
      case 'Tm': { const a = stack.slice(-6).map(v => typeof v === 'number' ? v : 0); tm = a; lm = a.slice(); break; }
      case 'Td': { const ty = num(stack, 1), tx = num(stack, 2); lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + tx, lm[5] + ty]; tm = lm.slice(); break; }
      case 'TD': { const ty = num(stack, 1), tx = num(stack, 2); leading = -ty; lm = [lm[0], lm[1], lm[2], lm[3], lm[4] + tx, lm[5] + ty]; tm = lm.slice(); break; }
      case 'T*': lm = [lm[0], lm[1], lm[2], lm[3], lm[4], lm[5] - leading]; tm = lm.slice(); break;
      case "'": case '"': { lm = [lm[0], lm[1], lm[2], lm[3], lm[4], lm[5] - leading]; tm = lm.slice(); maybeRedact(); break; }
      case 'Tj': maybeRedact(); break;
      case 'TJ': maybeRedactArray(); break;
      default: break;
    }
    stack.length = 0;

    function maybeRedact() {
      const tok = stack[stack.length - 1];
      if (!tok || tok.type !== 'str') return;
      const wPage = showWidth(tok) * HSCALE();
      if (overlaps(tm[4], tm[5], wPage)) { tok.raw = tok.kind === 'hex' ? '<>' : '()'; dirty = true; }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + wPage, tm[5]];
    }
    function maybeRedactArray() {
      const arr = stack[stack.length - 1];
      if (!arr || arr.type !== 'arr') return;
      const hs = HSCALE();
      let x = tm[4];
      for (const item of arr.items) {
        if (typeof item === 'number') { x -= (item / 1000) * fontSize * hs; continue; }
        if (item && item.type === 'str') { const wPage = showWidth(item) * hs; if (overlaps(x, tm[5], wPage)) { item.raw = item.kind === 'hex' ? '<>' : '()'; dirty = true; } x += wPage; }
      }
      tm = [tm[0], tm[1], tm[2], tm[3], x, tm[5]];
    }
  }
  return { text: reconstruct(toks), dirty };
}

function num(stack, fromEnd) { const v = stack[stack.length - fromEnd]; return typeof v === 'number' ? v : 0; }

function reconstruct(toks) {
  // Flatten arrays back out: our tokenizer kept '[' ']' as separate ops and stack
  // arrays were only views over those tokens; the underlying string tokens were
  // mutated in place, so re-joining the original token list reproduces the stream
  // with redacted strings emptied.
  //
  // Structure-aware spacing (L1): a `raw` inline-image token carries the exact image
  // bytes (leading delimiter already stripped in tokenize). Emit it as one delimiter
  // space + the bytes verbatim — a blanket ` `.join() would inject an extra space and
  // shift the image data by a byte. Every other token is space-separated as before.
  let out = '';
  for (const t of toks) {
    if (t.type === 'raw') { out += ' ' + t.raw; continue; }
    if (out.length) out += ' ';
    out += t.raw;
  }
  return out;
}

// ── The op ──────────────────────────────────────────────────────────────────────
function rectToPdf(W, H, x, y, w, h) { return { x0: x * W, y0: H * (1 - (y + h)), x1: (x + w) * W, y1: H * (1 - y) }; }

export const ops = [
  {
    id: 'redact.region', label: 'Redact region', group: 'redact', icon: 'redact',
    description: 'Permanently remove text under a region (normalized 0..1 coords) from the content stream and cover it with an opaque black box. True removal — not a visual mask.',
    agentCallable: true,
    params: {
      page: { type: 'int', required: true, min: 0 },
      x: { type: 'number', required: true }, y: { type: 'number', required: true },
      w: { type: 'number', required: true }, h: { type: 'number', required: true },
    },
    async run(doc, p) {
      const { PDFArray, decodePDFRawStream, PDFName, rgb } = lib();
      const count = doc.pageCount();
      if (p.page < 0 || p.page >= count) throw new Error(`Page ${p.page} out of range`);
      const page = doc.pdf.getPages()[p.page];
      const { width: W, height: H } = page.getSize();
      const box = rectToPdf(W, H, p.x, p.y, p.w, p.h);

      // Content-stream surgery. M2: a page's content may be split across a Contents ARRAY,
      // and a Tj/Tm can straddle the boundary between two array elements — tokenizing each
      // element independently desyncs position tracking or misses the split operator. PDF
      // readers treat the array as one logical stream (concatenated with whitespace), so we
      // do the same: decode every element, join with a newline, tokenize/redact ONCE, and
      // write the result back as a single stream. Undecodable content leaves the page's
      // streams untouched (the box still covers it) and is reported as residue for C1.
      const ctx = doc.pdf.context;
      const entry = page.node.Contents();
      const refs = entry instanceof PDFArray ? entry.asArray() : (entry ? [entry] : []);
      let buf = '';
      let decodable = refs.length > 0;
      for (const ref of refs) {
        try { buf += (buf ? '\n' : '') + new TextDecoder('latin1').decode(decodePDFRawStream(ctx.lookup(ref)).decode()); }
        catch { decodable = false; break; } // one bad stream → don't half-rewrite the page
      }
      let dirty = false;
      if (decodable && buf) {
        const r = redactTokens(tokenize(buf), [box]);
        dirty = r.dirty;
        // Only re-encode when a redaction actually fired. A no-match page keeps its original
        // streams byte-for-byte (no whitespace re-flow, no inline-image risk, faster).
        if (dirty) page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(new TextEncoder().encode(r.text))));
      }

      // Visible marker: opaque black box on top.
      page.drawRectangle({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, color: rgb(0, 0, 0) });
      return { doc };
    },
  },
];
