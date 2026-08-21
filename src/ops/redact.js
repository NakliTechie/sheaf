// ops/redact.js — TRUE redaction. Not a black box over live text: the text is
// removed so it cannot be extracted, copied, or read by any tool. Then an opaque black
// rectangle is drawn over the region as the visible marker. Verifiable: after redaction
// the target's bytes are gone from the file (see test/redact.mjs).
//
// Coverage (what gets truly removed under the box):
//   • Page content-stream text — tokenize the stream, track the full text-to-page matrix
//     (text matrix × CTM, following q/Q/cm/BT), and empty any show operator (Tj/TJ/'/")
//     whose page-space run overlaps the box. A Contents ARRAY is concatenated first so a
//     Tj/Tm split across the boundary is not missed (M2). Advance is matrix-scaled and
//     biased to over-removal (M1).
//   • Form-XObject text — each `Do` under the box is followed with its CTM; the box is
//     mapped into the XObject's space and its stream redacted in place (H3).
//   • Annotations — a text-bearing annotation (FreeText / Widget / any /Contents or field
//     /V) whose rect overlaps the box is removed and its text keys scrubbed (H3).
//
// Honesty (C1): whatever cannot be positively verified-removed — rotated/skewed runs,
// nested or rotated form XObjects, undecodable streams — is reported as residue. In that
// case the op still covers the area but with a distinct red-bordered marker and returns a
// `warning`, so un-removed text is NEVER presented as cleanly redacted.

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

// 2-D affine matrix concatenation in PDF's [a b c d e f] convention (row-vector × matrix).
// `cm` sets CTM' = M × CTM; the text-to-page map is Tm × CTM. Exported for the op + tests.
export function matMul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}
const IDENTITY = [1, 0, 0, 1, 0, 0];

// Walk tokens, track the full text-to-page transform (text matrix × CTM), and empty any
// string token whose page-space run overlaps a box. Boxes are PDF-space rects {x0,y0,x1,y1}.
// Also collects what it CANNOT guarantee, for the honesty layer:
//   • residueRotated — a rotated/skewed run near a box (our axis-aligned overlap can't confirm)
//   • doSites        — every form-XObject `Do` with the CTM in effect (the op recurses into these)
// Returns { text, dirty, residueRotated, doSites }.
export function redactTokens(toks, boxes, defaultFontSize = 12) {
  let tm = [1, 0, 0, 1, 0, 0];   // text matrix
  let lm = [1, 0, 0, 1, 0, 0];   // line matrix
  let ctm = [1, 0, 0, 1, 0, 0];  // current transformation matrix (q/Q/cm)
  const gstack = [];             // graphics-state stack (CTM only — all we need here)
  let fontSize = defaultFontSize, leading = 0;
  let dirty = false;             // did any show-operator actually get emptied?
  let residueRotated = false;    // a rotated run near a box we could not verify-remove
  const doSites = [];            // { name, ctm } for each XObject invocation
  const stack = [];
  const EPS = 1e-6;

  // A run maps to page space via E = Tm × CTM. For an axis-aligned E the run is a horizontal
  // segment we can test against the (axis-aligned) box; a rotated/skewed E (E[1]/E[2] != 0) we
  // do not trust — those go to the residue path. Bias toward OVER-removal (ascent 0.85em /
  // descent 0.25em band, 0.55em/glyph advance): redaction must never miss text under the box.
  const nearBox = (x, y, m) => boxes.some(b => x >= b.x0 - m && x <= b.x1 + m && y >= b.y0 - m && y <= b.y1 + m);
  const showWidth = (tok) => { // text-space advance estimate (biased slightly high)
    const glyphs = tok.kind === 'hex' ? hexLen(tok.raw) : litLen(tok.raw);
    return glyphs * fontSize * 0.55;
  };
  // Test/empty one run whose local text matrix is `m` (tm with its running x); returns whether
  // it was emptied. Mutates `tok.raw` on a hit.
  const tryRun = (tok, m, wText) => {
    const E = matMul(m, ctm);
    const rotated = Math.abs(E[1]) > EPS || Math.abs(E[2]) > EPS;
    if (rotated) { if (nearBox(E[4], E[5], fontSize)) residueRotated = true; return false; }
    const dx = wText * E[0];                       // page-space horizontal span (handles flips)
    const x0r = Math.min(E[4], E[4] + dx), x1r = Math.max(E[4], E[4] + dx);
    const fsV = fontSize * Math.abs(E[3] || 1);
    const asc = fsV * 0.85, desc = fsV * 0.25;
    const hit = boxes.some(b => x1r >= b.x0 && x0r <= b.x1 && E[5] + asc >= b.y0 && E[5] - desc <= b.y1);
    if (hit) { tok.raw = tok.kind === 'hex' ? '<>' : '()'; dirty = true; }
    return hit;
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'num') { stack.push(t.value); continue; }
    if (t.type === 'str' || t.type === 'name') { stack.push(t); continue; }
    const op = t.raw;
    if (op === '[') { stack.push('['); continue; }
    if (op === ']') { const arr = []; while (stack.length && stack[stack.length - 1] !== '[') arr.unshift(stack.pop()); stack.pop(); stack.push({ type: 'arr', items: arr }); continue; }

    switch (op) {
      case 'q': gstack.push(ctm.slice()); break;
      case 'Q': ctm = gstack.pop() || IDENTITY.slice(); break;
      case 'cm': { const m = stack.slice(-6).map(v => typeof v === 'number' ? v : 0); if (m.length === 6) ctm = matMul(m, ctm); break; }
      case 'BT': tm = IDENTITY.slice(); lm = IDENTITY.slice(); break; // text matrices reset at BT
      case 'Do': { const nm = stack[stack.length - 1]; if (nm && nm.type === 'name') doSites.push({ name: nm.raw, ctm: ctm.slice() }); break; }
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
      const wText = showWidth(tok);
      tryRun(tok, tm, wText);
      // Advance the text matrix along its own x-axis by the run width (text space).
      tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + wText * tm[0], tm[5] + wText * tm[1]];
    }
    function maybeRedactArray() {
      const arr = stack[stack.length - 1];
      if (!arr || arr.type !== 'arr') return;
      // Track the running x in text space; each element is tested at its own local matrix.
      // (Number adjustments and per-item advance affect x only — sufficient for axis-aligned
      // runs; rotated runs are already sent to the residue path by tryRun.)
      let xText = tm[4];
      for (const item of arr.items) {
        if (typeof item === 'number') { xText -= (item / 1000) * fontSize; continue; }
        if (item && item.type === 'str') {
          const wText = showWidth(item);
          tryRun(item, [tm[0], tm[1], tm[2], tm[3], xText, tm[5]], wText);
          xText += wText;
        }
      }
      tm = [tm[0], tm[1], tm[2], tm[3], xText, tm[5]];
    }
  }
  return { text: reconstruct(toks), dirty, residueRotated, doSites };
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
function rectsOverlap(a, b) { return a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1; }

// Content-stream bytes are latin1 (one char == one byte). TextEncoder would UTF-8-encode and
// corrupt any byte > 127 — inline-image data, non-ASCII string literals. Encode 1:1.
function latin1Bytes(str) { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff; return b; }

// Rebuild a stream with new (decoded) content while preserving its dict — used to clone a
// form XObject we redacted, so other users of the original are untouched. Written UNcompressed
// (Filter dropped) to avoid needing a deflater; correctness over a few bytes.
function cloneStreamWithContent(ctx, orig, bytes, L) {
  const { PDFRawStream, PDFName, PDFNumber } = L;
  const dict = orig.dict.clone(ctx);
  dict.delete(PDFName.of('Filter'));
  dict.delete(PDFName.of('DecodeParms'));
  dict.set(PDFName.of('Length'), PDFNumber.of(bytes.length));
  return PDFRawStream.of(dict, bytes);
}

function strOf(v) { return v && typeof v.asString === 'function' ? v.asString() : (v ? String(v) : ''); }
// PDFName.asString()/encodedName carry a leading '/'; strip it so callers compare bare names.
function nameOf(v) { const s = v && typeof v.asString === 'function' ? v.asString() : (v && v.encodedName) || ''; return s.replace(/^\//, ''); }

// H3 — remove text-bearing annotations whose /Rect overlaps the box. FreeText comments,
// form-field widgets (whose /V value is separately extractable), and any annotation carrying
// /Contents text are true content: covering them with a box while leaving the annotation (and
// its value) in the file is exactly the silent failure C1 forbids. We drop the annotation from
// the page and scrub its text keys (and the field value) so nothing survives in the bytes.
function removeTextAnnotsUnderBox(ctx, page, box, L) {
  const { PDFArray, PDFName, PDFDict } = L;
  const annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
  if (!(annots instanceof PDFArray)) return 0;
  const keep = [];
  let removed = 0;
  for (const ref of annots.asArray()) {
    const d = ctx.lookup(ref);
    if (!(d instanceof PDFDict)) { keep.push(ref); continue; }
    const rectArr = ctx.lookup(d.get(PDFName.of('Rect')));
    let overlaps = false;
    if (rectArr instanceof PDFArray) {
      const r = rectArr.asArray().map(n => (n && n.asNumber ? n.asNumber() : Number(n)));
      overlaps = rectsOverlap({ x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) }, box);
    }
    if (!overlaps) { keep.push(ref); continue; }
    const sub = nameOf(d.get(PDFName.of('Subtype')));
    const hasText = sub === 'FreeText' || sub === 'Widget' || strOf(d.get(PDFName.of('Contents'))) || d.get(PDFName.of('V'));
    if (!hasText) { keep.push(ref); continue; }
    // Scrub the annotation's own text + appearance, and the form field value it may hold.
    for (const k of ['Contents', 'RC', 'V', 'DV', 'AP']) d.delete(PDFName.of(k));
    const parent = ctx.lookup(d.get(PDFName.of('Parent')));
    if (parent instanceof PDFDict) for (const k of ['V', 'DV']) parent.delete(PDFName.of(k));
    removed++;
  }
  if (removed) {
    if (keep.length) page.node.set(PDFName.of('Annots'), ctx.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  return removed;
}

// H3 — recurse into form XObjects invoked under the box. Each `Do` came with the CTM in
// effect; combined with the XObject's own /Matrix it gives the page-from-XObject transform.
// For an axis-aligned transform we map the page box into XObject space, redact that stream, and
// OVERWRITE the XObject object in place at its ref (pdf-lib serializes every registered object
// with no GC, so a clone+rebind would leave the original secret-bearing stream orphaned yet
// still in the output bytes — itself a leak). Overwriting removes it with no orphan; a form
// XObject shared across pages is therefore redacted wherever it appears (safe over-removal, not
// a leak). Rotated/degenerate transforms, nested XObjects, undecodable streams, and non-indirect
// entries go to `residues` — the honesty layer refuses to claim those as removed.
function redactXObjectsUnderBox(ctx, page, doSites, box, L, residues) {
  if (!doSites.length) return;
  const { PDFName, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream } = L;
  const resources = ctx.lookup(page.node.get(PDFName.of('Resources')));
  const xobjDict = resources instanceof PDFDict ? ctx.lookup(resources.get(PDFName.of('XObject'))) : null;
  if (!(xobjDict instanceof PDFDict)) { residues.push('a form XObject could not be resolved'); return; }

  const perName = new Map(); // name → { ref, xobj, boxes[] }
  for (const site of doSites) {
    const key = site.name.replace(/^\//, '');
    const ref = xobjDict.get(PDFName.of(key));
    if (!(ref instanceof PDFRef)) { residues.push('a form XObject is not an indirect object'); continue; }
    const xobj = ctx.lookup(ref);
    if (!(xobj instanceof PDFRawStream)) continue;              // image / missing — no text
    if (nameOf(xobj.dict.get(PDFName.of('Subtype'))) !== 'Form') continue; // only forms carry text
    const mArr = xobj.dict.get(PDFName.of('Matrix'));
    const M = mArr && mArr.asArray ? mArr.asArray().map(n => n.asNumber()) : [1, 0, 0, 1, 0, 0];
    const Mfull = matMul(M, site.ctm);
    if (Math.abs(Mfull[1]) > 1e-6 || Math.abs(Mfull[2]) > 1e-6) { residues.push('text in a rotated form XObject'); continue; }
    if (Math.abs(Mfull[0]) < 1e-6 || Math.abs(Mfull[3]) < 1e-6) { residues.push('text in a form XObject with a degenerate transform'); continue; }
    const a = Mfull[0], d = Mfull[3], e = Mfull[4], f = Mfull[5];
    const bx = [(box.x0 - e) / a, (box.x1 - e) / a], by = [(box.y0 - f) / d, (box.y1 - f) / d];
    const tb = { x0: Math.min(...bx), x1: Math.max(...bx), y0: Math.min(...by), y1: Math.max(...by) };
    if (!perName.has(key)) perName.set(key, { ref, xobj, boxes: [] });
    perName.get(key).boxes.push(tb);
  }
  for (const { ref, xobj, boxes } of perName.values()) {
    let text;
    try { text = new TextDecoder('latin1').decode(decodePDFRawStream(xobj).decode()); }
    catch { residues.push('a form XObject stream could not be decoded'); continue; }
    const r = redactTokens(tokenize(text), boxes);
    if (r.residueRotated) residues.push('rotated text inside a form XObject');
    if (r.doSites.length) residues.push('text in a nested form XObject'); // depth-1 only
    if (r.dirty) ctx.assign(ref, cloneStreamWithContent(ctx, xobj, latin1Bytes(r.text), L));
  }
}

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
      const L = lib();
      const { PDFArray, decodePDFRawStream, PDFName, rgb } = L;
      const count = doc.pageCount();
      if (p.page < 0 || p.page >= count) throw new Error(`Page ${p.page} out of range`);
      const page = doc.pdf.getPages()[p.page];
      const { width: W, height: H } = page.getSize();
      const box = rectToPdf(W, H, p.x, p.y, p.w, p.h);
      const ctx = doc.pdf.context;
      const residues = []; // reasons removal could NOT be guaranteed (C1 honesty)

      // 1) Page content stream. M2: content may be split across a Contents ARRAY and a Tj/Tm
      //    can straddle the boundary — tokenizing each element independently desyncs position
      //    tracking or misses the split operator. Readers treat the array as one logical
      //    stream, so we decode+concatenate all elements, tokenize/redact ONCE, and write back
      //    a single stream. The walk also reports rotated-text residue and the form-XObject
      //    Do sites to recurse into.
      const entry = page.node.Contents();
      const refs = entry instanceof PDFArray ? entry.asArray() : (entry ? [entry] : []);
      let buf = '';
      let decodable = refs.length > 0;
      for (const ref of refs) {
        try { buf += (buf ? '\n' : '') + new TextDecoder('latin1').decode(decodePDFRawStream(ctx.lookup(ref)).decode()); }
        catch { decodable = false; break; } // one bad stream → don't half-rewrite the page
      }
      if (!decodable && refs.length) residues.push('a page content stream could not be decoded');
      if (decodable && buf) {
        const r = redactTokens(tokenize(buf), [box]);
        if (r.residueRotated) residues.push('rotated or skewed text near the region');
        // 2) Form XObjects invoked under the box get their own text removed (or reported).
        redactXObjectsUnderBox(ctx, page, r.doSites, box, L, residues);
        // Only re-encode the page stream when a redaction actually fired. A no-match page keeps
        // its streams byte-for-byte. latin1 encode (not UTF-8) so bytes > 127 stay intact.
        if (r.dirty) page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(latin1Bytes(r.text))));
      }

      // 3) Annotations (comments, form-field values) whose rect overlaps the box are removed.
      removeTextAnnotsUnderBox(ctx, page, box, L);

      // 4) Marker + honesty (C1). When every text-bearing construct under the box was positively
      //    neutralized, draw the normal opaque black box. When some text could NOT be verified
      //    removed, still cover it visually but with a distinct red-bordered marker and return a
      //    loud warning — never present un-removed text as cleanly redacted.
      if (residues.length) {
        page.drawRectangle({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, color: rgb(0, 0, 0), borderColor: rgb(0.85, 0, 0), borderWidth: 2 });
        const uniq = [...new Set(residues)];
        return { doc, warning: `Area covered, but removal could not be verified: ${uniq.join('; ')}. Treat the underlying text as possibly still present (marked with a red border).` };
      }
      page.drawRectangle({ x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, color: rgb(0, 0, 0) });
      return { doc };
    },
  },
];
