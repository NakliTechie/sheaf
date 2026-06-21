// textsafe.js — make arbitrary text safe to draw with pdf-lib's standard fonts.
//
// Standard fonts (Helvetica etc.) encode WinAnsi/CP1252 only, so drawText THROWS on
// any character outside it (an arrow, a maths symbol, CJK, an emoji). For v1.0 we
// sanitize: keep CP1252-encodable characters, map a handful of common symbols to
// ASCII, and replace anything else with '?'. This guarantees text ops never crash on
// real-world input. Full Unicode (non-Latin scripts) needs a vendored Unicode font +
// fontkit — a v1.x addition; until then those characters degrade to '?', visibly, not
// a silent failure or a crash.

// Symbol → ASCII mappings for common non-CP1252 characters worth preserving meaning.
const MAP = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '×': 'x', '÷': '/',
  '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '′': "'", '″': '"', '⁄': '/',
};

// CP1252 code points above 0xFF that the WinAnsi encoder DOES handle (smart quotes,
// dashes, ellipsis, euro, bullet, trademark, …). Keep these as-is.
const CP1252_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);

export function winAnsiSafe(input) {
  let out = '';
  for (const ch of String(input)) {
    if (MAP[ch] !== undefined) { out += MAP[ch]; continue; }
    const cp = ch.codePointAt(0);
    if (ch === '\n' || ch === '\t') { out += ch; continue; }
    if (cp >= 0x20 && cp <= 0x7E) { out += ch; continue; }          // printable ASCII
    if (cp >= 0xA0 && cp <= 0xFF) { out += ch; continue; }          // Latin-1 high
    if (CP1252_EXTRA.has(cp)) { out += ch; continue; }              // CP1252 extras
    out += '?';                                                     // visible fallback
  }
  return out;
}
