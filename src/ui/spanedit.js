// spanedit.js — edit text in place. Click on a line of text; we locate the text run
// under the click via the PDF.js text layer, pre-fill its content, and on submit
// whiteout that exact region and retype at the matched size, family, and baseline.
// Position + size + font FAMILY (serif/sans/mono, weight, slant) are matched
// automatically from the PDF.js text layer and the loaded font object; the retype uses
// the closest Standard-14 face. Reusing the exact EMBEDDED glyph program (perfect for
// same-glyph edits) needs a vendored fontkit and is the remaining step (plan/pending.md).

import { currentRenderDoc } from './rendoc.js';
import { dispatch } from '../core/runner.js';
import { formModal } from './modal.js';
import { toast } from './toast.js';

// Classify a PostScript/family name into family + weight + slant. The PS name is the
// strongest signal (e.g. "ABCDEF+Times-BoldItalic"); fontFamily backs it up.
function classifyFont(psName, family) {
  const s = `${psName || ''} ${family || ''}`.toLowerCase();
  const bold = /bold|black|heavy|semibold|\bbd\b/.test(s);
  const italic = /italic|oblique/.test(s);
  let fam = 'sans';
  if (/courier|\bmono|consol|menlo|typewriter/.test(s)) fam = 'mono';
  else if ((/times|georgia|serif|roman|garamond|minion|antiqua|cambria|palatino|book/.test(s)) && !/sans/.test(s)) fam = 'serif';
  return { family: fam, bold, italic };
}

// Best-effort PostScript name for a text item's font. Fonts are loaded once the page
// has rendered, so commonObjs usually has it; degrade quietly to the style's family.
function fontNameOf(page, it) {
  try {
    const objs = page.commonObjs;
    if (objs && it.fontName && objs.has(it.fontName)) {
      const fo = objs.get(it.fontName);
      if (fo && (fo.name || fo.loadedName)) return fo.name || fo.loadedName;
    }
  } catch { /* commonObjs not ready — fall back to style family */ }
  return '';
}

// Find the text run under a normalized (0..1) click on a page.
async function findRun(pageIndex, nx, ny) {
  const pdf = currentRenderDoc();
  if (!pdf) return null;
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const tc = await page.getTextContent();
  let best = null, bestD = Infinity;
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [, b, , d, e, f] = it.transform;
    const h = it.height || Math.hypot(b, d) || 10;
    const w = it.width || 0;
    const x0 = e / W, y0 = (H - (f + h)) / H, x1 = (e + w) / W, y1 = (H - f) / H;
    if (nx >= x0 - 0.012 && nx <= x1 + 0.012 && ny >= y0 - 0.012 && ny <= y1 + 0.012) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, dd = (nx - cx) ** 2 + (ny - cy) ** 2;
      if (dd < bestD) {
        const psName = fontNameOf(page, it);
        const style = (tc.styles && tc.styles[it.fontName]) || {};
        const font = classifyFont(psName, style.fontFamily);
        // y1 is the run's baseline in normalized top-origin coords (bottom of the caps).
        bestD = dd;
        best = { str: it.str, x: x0, y: y0, w: w / W, h: h / H, fontSize: h, baseline: y1, ...font };
      }
    }
  }
  return best;
}

export async function editTextAt(pageIndex, nx, ny) {
  let run;
  try { run = await findRun(pageIndex, nx, ny); }
  catch (e) { return toast('Could not read the text layer', 'err', { detail: e.message }); }
  if (!run) return toast('No editable text there — use the Whiteout tool for scanned text', 'warn');

  const famLabel = { serif: 'Serif', sans: 'Sans', mono: 'Mono' }[run.family] || 'Sans';
  const style = `${famLabel}${run.bold ? ' Bold' : ''}${run.italic ? ' Italic' : ''}`;
  const v = await formModal('Edit text', [
    { name: 'text', label: `Replace with (leave blank to just remove) — matched font: ${style}`, value: run.str },
    { name: 'fontSize', label: 'Size (pt)', type: 'number', value: Math.round(run.fontSize) },
  ]);
  if (!v) return;
  // Cover the detected run (a touch of padding) and retype over it in the matched
  // family/weight/slant, on the original baseline.
  dispatch('text.whiteout', {
    page: pageIndex,
    x: Math.max(0, run.x - 0.003), y: Math.max(0, run.y - 0.003),
    w: Math.min(1, run.w + 0.006), h: Math.min(1, run.h + 0.008),
    text: v.text, fontSize: v.fontSize,
    fontFamily: run.family, bold: run.bold, italic: run.italic, baseline: run.baseline,
  });
}
