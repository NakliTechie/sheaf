// spanedit.js — edit text in place. Click on a line of text; we locate the text run
// under the click via the PDF.js text layer, pre-fill its content, and on submit
// whiteout that exact region and retype at the matched size. This is the practical
// ~80% of "span-replace": position + size are matched automatically (no manual region
// drawing). Matching the original EMBEDDED font is the v1.x step — retype uses Helvetica.

import { currentRenderDoc } from './rendoc.js';
import { dispatch } from '../core/runner.js';
import { formModal } from './modal.js';
import { toast } from './toast.js';

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
      if (dd < bestD) { bestD = dd; best = { str: it.str, x: x0, y: y0, w: w / W, h: h / H, fontSize: h }; }
    }
  }
  return best;
}

export async function editTextAt(pageIndex, nx, ny) {
  let run;
  try { run = await findRun(pageIndex, nx, ny); }
  catch (e) { return toast('Could not read the text layer', 'err', { detail: e.message }); }
  if (!run) return toast('No editable text there — use the Whiteout tool for scanned text', 'warn');

  const v = await formModal('Edit text', [
    { name: 'text', label: 'Replace with (leave blank to just remove)', value: run.str },
    { name: 'fontSize', label: 'Size (pt)', type: 'number', value: Math.round(run.fontSize) },
  ]);
  if (!v) return;
  // Cover the detected run (a touch of padding) and retype over it.
  dispatch('text.whiteout', {
    page: pageIndex,
    x: Math.max(0, run.x - 0.003), y: Math.max(0, run.y - 0.003),
    w: Math.min(1, run.w + 0.006), h: Math.min(1, run.h + 0.008),
    text: v.text, fontSize: v.fontSize,
  });
}
