// make-seed.mjs — generate guide/seed/demo.pdf, the captured document for the guide.
// Uses the SAME vendored pdf-lib the app ships (engines/pdf-lib/1.17.1), so the seed
// is reproducible with no extra dependency. A four-page "quarterly report" with real
// selectable text: a title page, a figure-laden body page with a deliberately
// sensitive line (for the redaction shot), a prose page (for edit-text / whiteout),
// and a sign-off page. Re-run: `node guide/seed/make-seed.mjs`.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const { PDFDocument, StandardFonts, rgb } = await import(
  join(ROOT, 'engines/pdf-lib/1.17.1/pdf-lib.esm.js')
);

const PAGE = [612, 792]; // US Letter
const INK = rgb(0.12, 0.13, 0.16);
const MUTE = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.18, 0.34, 0.62);
const RULE = rgb(0.8, 0.82, 0.86);

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

function page() {
  const p = doc.addPage(PAGE);
  return p;
}
function text(p, s, x, y, size = 11, f = font, color = INK) {
  p.drawText(s, { x, y, size, font: f, color });
}
function rule(p, y, x0 = 64, x1 = 548) {
  p.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.8, color: RULE });
}
function band(p) {
  p.drawRectangle({ x: 0, y: 740, width: 612, height: 52, color: rgb(0.96, 0.97, 0.99) });
  text(p, 'ACME ROBOTICS', 64, 758, 12, bold, ACCENT);
  text(p, 'CONFIDENTIAL — INTERNAL', 410, 758, 9, font, MUTE);
}

// ── Page 1 — title ──────────────────────────────────────────────────────────────
{
  const p = page();
  band(p);
  text(p, 'Quarterly Operating Review', 64, 600, 30, bold);
  text(p, 'Fiscal Q3 — Manufacturing & Fulfilment', 64, 566, 14, font, MUTE);
  rule(p, 548);
  text(p, 'Prepared by the Operations Office', 64, 520, 11);
  text(p, 'Distribution: Board of Directors, Executive Staff', 64, 502, 11);
  text(p, 'Document reference: OPS-Q3-0042', 64, 484, 11);
  text(p, 'Summary', 64, 440, 15, bold);
  const para = [
    'Throughput recovered to plan after the Line 4 retrofit, with unit cost down',
    '6.2% quarter on quarter. Fulfilment held a 98.1% on-time rate despite the',
    'October demand spike. Two risks remain open: supplier concentration in the',
    'drive-module category, and a widening gap in second-shift staffing.',
  ];
  para.forEach((line, i) => text(p, line, 64, 410 - i * 18, 12));
  text(p, 'This document is a sample used to illustrate Sheaf. Every page is real,', 64, 150, 10, font, MUTE);
  text(p, 'selectable PDF text — redaction here removes the underlying bytes.', 64, 136, 10, font, MUTE);
}

// ── Page 2 — figures + a sensitive line (redaction shot) ─────────────────────────
{
  const p = page();
  band(p);
  text(p, 'Key Figures', 64, 690, 20, bold);
  rule(p, 676);
  const rows = [
    ['Units shipped', '184,920', '+4.1%'],
    ['Unit cost (USD)', '12.84', '-6.2%'],
    ['On-time fulfilment', '98.1%', '+0.7pt'],
    ['Return rate', '1.3%', '-0.2pt'],
    ['Second-shift fill', '71%', '-9pt'],
  ];
  text(p, 'Metric', 64, 648, 11, bold);
  text(p, 'Value', 320, 648, 11, bold);
  text(p, 'QoQ', 470, 648, 11, bold);
  rows.forEach((r, i) => {
    const y = 624 - i * 26;
    text(p, r[0], 64, y, 12);
    text(p, r[1], 320, y, 12);
    text(p, r[2], 470, y, 12, font, r[2].startsWith('-') && r[0] !== 'Unit cost (USD)' ? rgb(0.7, 0.2, 0.2) : rgb(0.16, 0.5, 0.3));
    rule(p, y - 8);
  });
  text(p, 'Banking detail (to be redacted in the public copy):', 64, 430, 12, bold);
  text(p, 'Settlement account 4012 8888 8888 1881 — routing 021000021', 64, 408, 12, font, rgb(0.6, 0.15, 0.15));
  text(p, 'Primary contact: dana.okoro@acme.example  ·  +1 415 555 0142', 64, 388, 12);
  text(p, 'Notes', 64, 340, 15, bold);
  const notes = [
    'The Line 4 retrofit is fully commissioned. Remaining capital is earmarked',
    'for the second-shift expansion pending a final staffing review in Q4.',
  ];
  notes.forEach((line, i) => text(p, line, 64, 314 - i * 18, 12));
}

// ── Page 3 — prose (edit-text / whiteout shot) ───────────────────────────────────
{
  const p = page();
  band(p);
  text(p, 'Outlook', 20 + 44, 690, 20, bold);
  rule(p, 676);
  const prose = [
    'We expect throughput to stay at plan into Q4 as the retrofit beds in. The',
    'principal lever is staffing: closing the second-shift gap would add an',
    'estimated nine points of effective capacity without further capital outlay.',
    '',
    'Supplier concentration remains the key downside. A single vendor supplies',
    'sixty-two percent of drive modules; qualification of a second source is',
    'underway and should complete before the end of the fiscal year.',
    '',
    'No change is recommended to the published full-year guidance at this time.',
  ];
  prose.forEach((line, i) => line && text(p, line, 64, 644 - i * 20, 12));
  text(p, 'Figure 1 — capacity vs. plan', 64, 360, 11, bold);
  // a tiny bar chart so the page has a visual
  const base = 250, bx = 80, bw = 46, gap = 26;
  [90, 76, 88, 102, 110].forEach((h, i) => {
    p.drawRectangle({ x: bx + i * (bw + gap), y: base, width: bw, height: h, color: ACCENT });
  });
  ['Jun', 'Jul', 'Aug', 'Sep', 'Oct'].forEach((m, i) =>
    text(p, m, bx + i * (bw + gap) + 12, base - 16, 10, font, MUTE));
}

// ── Page 4 — sign-off (signature shot) ───────────────────────────────────────────
{
  const p = page();
  band(p);
  text(p, 'Approval', 64, 690, 20, bold);
  rule(p, 676);
  text(p, 'This review has been prepared for board approval. Sign below to record', 64, 640, 12);
  text(p, 'acknowledgement of the figures and the two open risks.', 64, 622, 12);
  // Real AcroForm fields, so the Forms shot detects and fills something live.
  const form = doc.getForm();
  text(p, 'Reviewer name', 64, 560, 11, bold);
  const nameField = form.createTextField('review.reviewer');
  nameField.setText('Priya Menon');
  nameField.addToPage(p, { x: 64, y: 528, width: 236, height: 22, borderWidth: 1, borderColor: RULE });
  text(p, 'Title', 330, 560, 11, bold);
  const titleField = form.createTextField('review.title');
  titleField.setText('Operations Director');
  titleField.addToPage(p, { x: 330, y: 528, width: 218, height: 22, borderWidth: 1, borderColor: RULE });
  text(p, 'Date', 64, 488, 11, bold);
  const dateField = form.createTextField('review.date');
  dateField.addToPage(p, { x: 64, y: 456, width: 156, height: 22, borderWidth: 1, borderColor: RULE });
  const approved = form.createCheckBox('review.approved');
  approved.addToPage(p, { x: 330, y: 458, width: 18, height: 18, borderWidth: 1, borderColor: RULE });
  text(p, 'Recommend for board approval', 356, 462, 11);
  text(p, 'Signature', 64, 410, 11, bold);
  rule(p, 376, 64, 300);
}

doc.setTitle('ACME Robotics — Quarterly Operating Review (Q3)');
doc.setAuthor('Operations Office');
doc.setSubject('Sample document for the Sheaf guide');
doc.setKeywords(['sheaf', 'demo', 'quarterly review']);
// Determinism: pin producer/dates off so the seed is byte-stable across rebuilds.
doc.setProducer('Sheaf seed generator');
doc.setCreationDate(new Date(0));
doc.setModificationDate(new Date(0));

const bytes = await doc.save({ useObjectStreams: true });
writeFileSync(join(HERE, 'demo.pdf'), bytes);
console.log(`✓ wrote guide/seed/demo.pdf (${(bytes.length / 1024).toFixed(1)} KB, ${doc.getPageCount()} pages)`);
