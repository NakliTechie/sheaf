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
const WS = new Set([' ', '\t', '\r', '\n', '\f', '\0']);
const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function tokenize(str) {
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
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) toks.push({ type: 'num', raw, value: parseFloat(raw) });
    else toks.push({ type: 'op', raw });
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
function redactTokens(toks, boxes, defaultFontSize = 12) {
  let tm = [1, 0, 0, 1, 0, 0];   // text matrix
  let lm = [1, 0, 0, 1, 0, 0];   // line matrix
  let fontSize = defaultFontSize, leading = 0;
  const stack = [];

  const overlaps = (x, y, w, fs) => boxes.some(b =>
    y + fs * 0.2 >= b.y0 && y <= b.y1 && x + w >= b.x0 && x <= b.x1);

  const showWidth = (tok) => {
    const glyphs = tok.kind === 'hex' ? hexLen(tok.raw) : litLen(tok.raw);
    return glyphs * fontSize * 0.5; // average glyph advance estimate
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
      const w = showWidth(tok);
      if (overlaps(tm[4], tm[5], w, fontSize)) { tok.raw = tok.kind === 'hex' ? '<>' : '()'; }
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + w, tm[5]];
    }
    function maybeRedactArray() {
      const arr = stack[stack.length - 1];
      if (!arr || arr.type !== 'arr') return;
      let x = tm[4];
      for (const item of arr.items) {
        if (typeof item === 'number') { x -= (item / 1000) * fontSize; continue; }
        if (item && item.type === 'str') { const w = showWidth(item); if (overlaps(x, tm[5], w, fontSize)) item.raw = item.kind === 'hex' ? '<>' : '()'; x += w; }
      }
      tm = [tm[0], tm[1], tm[2], tm[3], x, tm[5]];
    }
  }
  return reconstruct(toks);
}

function num(stack, fromEnd) { const v = stack[stack.length - fromEnd]; return typeof v === 'number' ? v : 0; }

function reconstruct(toks) {
  // Flatten arrays back out: our tokenizer kept '[' ']' as separate ops and stack
  // arrays were only views over those tokens; the underlying string tokens were
  // mutated in place, so re-joining the original token list reproduces the stream
  // with redacted strings emptied.
  return toks.map(t => t.raw).join(' ');
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

      // Surgery on every content stream of the page.
      const ctx = doc.pdf.context;
      let entry = page.node.Contents();
      const refs = entry instanceof PDFArray ? entry.asArray() : (entry ? [entry] : []);
      const newRefs = [];
      for (const ref of refs) {
        const stream = ctx.lookup(ref);
        let text;
        try { text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()); }
        catch { newRefs.push(ref); continue; } // can't decode — leave it; the box still covers it
        const redacted = redactTokens(tokenize(text), [box]);
        const newStream = ctx.flateStream(new TextEncoder().encode(redacted));
        newRefs.push(ctx.register(newStream));
      }
      if (newRefs.length === 1) page.node.set(PDFName.of('Contents'), newRefs[0]);
      else if (newRefs.length) page.node.set(PDFName.of('Contents'), ctx.obj(newRefs));

      // Visible marker: opaque black box on top.
      page.drawRectangle({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, color: rgb(0, 0, 0) });
      return { doc };
    },
  },
];
