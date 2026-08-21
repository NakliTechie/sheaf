// _util.js — small shared helpers for ops (kept DRY: hex-colour parsing + data-URL decode).
// These were duplicated across annotate/marks/text/sign (hexToRgb) and convert/compress
// (dataUrlToBytes); one definition each so a fix lands in one place.

// "#rrggbb" (or "rrggbb") → [r,g,b] in 0..1; `fallback` if the string isn't a 6-hex colour.
export function hexToRgb(hex, fallback = [0, 0, 0]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// "data:<mime>;base64,XXXX" → Uint8Array of the decoded bytes.
export function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
