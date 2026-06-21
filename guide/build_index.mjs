// build_index.mjs — assemble the single-file guide/index.html from the captured
// screenshots + the authored caption/section DATA below. The prose is the source of
// truth and lives here, never in the generated HTML — so a full rebuild re-shoots and
// re-assembles but never loses a caption. The guide's chrome is themed from Sheaf's
// OWN design tokens (src/ui/theme.css), so it reads as part of the product.
//
// Edit captions/sections here → re-run (guide/regenerate.sh) → never hand-edit index.html.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS_DIR = join(HERE, 'screenshots', 'feature');
const GUIDE_BASE = '../'; // links back into the app from guide/index.html

// ── authored content ──────────────────────────────────────────────────────────────
// slug → { title, desc }. One real sentence per screen; never the slug.
const CAPTIONS = {
  welcome: { title: 'Open a PDF to start',
    desc: 'Drag a PDF in, pick one from disk, or open a whole folder. Everything happens in this browser tab — no account, no upload, and it works offline.' },
  editor: { title: 'The workspace',
    desc: 'A thumbnail rail, the page canvas, and one toolbar. Every button dispatches through the same core as the keyboard shortcuts and the optional agent face — one engine, several doors.' },
  pages: { title: 'Reorder, rotate, delete pages',
    desc: 'Select pages in the rail, then rotate, duplicate, delete, scale, extract, or insert blanks — or merge another PDF in. Drag a thumbnail to reorder. (Page 2 is shown rotated.)' },
  annotate: { title: 'Highlight, shapes & freehand',
    desc: 'Highlighter, rectangle, line, and pencil tools draw straight onto the page. Pick a colour in the toolbar and drag where you want the mark.' },
  'edit-text': { title: "Edit the text that's already there",
    desc: 'The Edit-text tool finds the line you click through the PDF text layer and lets you retype it in place, matched to the surrounding font and size.' },
  whiteout: { title: 'Whiteout & retype',
    desc: "Cover a region in white and optionally type replacement text over it — quick corrections that don't need true byte removal." },
  redact: { title: 'True redaction — not a black box',
    desc: 'Redaction removes the underlying text and image bytes from the PDF and then draws the bar. Save the file and the secret is genuinely gone — verifiable in the bytes, not just hidden under a rectangle.' },
  sign: { title: 'Signatures',
    desc: 'Type, draw, upload, or reuse a saved signature, then place it anywhere on the page. Saved signatures live in this browser only.' },
  forms: { title: 'Fill & flatten forms',
    desc: 'Sheaf detects AcroForm fields and fills them from a single dialog. Flatten the form to bake the values permanently into the page.' },
  marks: { title: 'Watermarks, page numbers, Bates',
    desc: 'Stamp a diagonal watermark, page numbers, sequential Bates numbers (for legal work), or a fixed header/footer across every page.' },
  ocr: { title: 'Make a scan searchable',
    desc: 'Tesseract runs entirely in the tab to add a searchable text layer to scanned pages, or to extract their text. Nothing is uploaded.' },
  convert: { title: 'Export & convert',
    desc: 'Render pages to images, pull out plain text, or save a converted copy. The original file is never touched.' },
  metadata: { title: 'Title, author, keywords',
    desc: "Read and edit the document's metadata. Writing is deterministic — Sheaf won't silently re-stamp modification dates you didn't change." },
  save: { title: 'Save in place, or a copy',
    desc: 'Save back to the same file (File System Access), drop a timestamped copy into a workspace folder, or download — your choice, no lock-in.' },
  ai: { title: 'Optional AI sidecar (BYOK)',
    desc: 'Off by default and fully removable. When enabled it reaches a local model or your own API key, and is honest about exactly what — if anything — leaves the machine.' },
  settings: { title: 'Preferences',
    desc: 'View mode, the developer agent face, AI configuration, and theme. Only preferences are ever persisted — never document content.' },
  help: { title: 'Keyboard & privacy',
    desc: 'In-app help lists the live keyboard grammar (read from the real registry, so it never drifts) and restates the privacy posture.' },
  'light-theme': { title: 'Light & dark',
    desc: 'One click toggles the theme. The whole UI is built from design tokens, so light and dark are a single variable swap — not a second stylesheet.' },
};

// Ordered sections → the guide's structure + TOC. Each item is a slug above.
const SECTIONS = [
  { id: 'start', title: 'Getting started',
    intro: 'Sheaf opens a PDF straight off your disk and edits it entirely in the browser tab. No account, no upload, no telemetry — and it works offline.',
    items: ['welcome', 'editor'] },
  { id: 'pages', title: 'Pages',
    intro: 'Page-level operations act on the pages you select in the left rail, or the current page when nothing is selected.',
    items: ['pages'] },
  { id: 'markup', title: 'Markup & text',
    intro: 'Add annotations on top of the page, or change the text that is already inside it.',
    items: ['annotate', 'edit-text', 'whiteout'] },
  { id: 'redaction', title: 'Redaction',
    intro: 'The feature Sheaf takes most seriously: removal that is real, not cosmetic.',
    items: ['redact'] },
  { id: 'sign-forms', title: 'Sign & forms',
    intro: 'Put a signature on the page, and work with interactive form fields.',
    items: ['sign', 'forms'] },
  { id: 'marks-export', title: 'Marks, OCR & export',
    intro: 'Stamp every page, lift text out of scans, and get pages back out as images or text.',
    items: ['marks', 'ocr', 'convert'] },
  { id: 'document', title: 'Document & saving',
    intro: 'Edit the document’s properties and control exactly how it is written back to disk.',
    items: ['metadata', 'save'] },
  { id: 'ai', title: 'AI sidecar',
    intro: 'AI is an optional, removable sidecar — never a requirement and never a default.',
    items: ['ai'] },
  { id: 'settings', title: 'Settings, help & themes',
    intro: 'Tune Sheaf to your taste; everything here stays local to your browser.',
    items: ['settings', 'help', 'light-theme'] },
];

// ── theme: pull Sheaf's dark design tokens so the guide reads as part of the product ─
function readDarkTokens() {
  const css = readFileSync(join(ROOT, 'src/ui/theme.css'), 'utf8');
  const start = css.indexOf(':root');
  const block = css.slice(start, css.indexOf('}', start));
  const vars = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

// ── map each slug to its captured screenshot (NN-slug.png) ──────────────────────────
function shotFor(slug) {
  const files = readdirSync(SHOTS_DIR).filter((f) => f.endsWith('.png'));
  const hit = files.find((f) => f.replace(/^\d+-/, '').replace(/\.png$/, '') === slug);
  return hit ? `screenshots/feature/${hit}` : null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── assemble ────────────────────────────────────────────────────────────────────────
function build() {
  const tok = readDarkTokens();
  const v = (name, fallback) => tok[name] || fallback;
  const missing = [];

  const tocItems = SECTIONS.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('');

  const sectionsHtml = SECTIONS.map((s) => {
    const cards = s.items.map((slug) => {
      const cap = CAPTIONS[slug];
      const shot = shotFor(slug);
      if (!cap || !shot) { missing.push(slug); return ''; }
      const search = `${s.title} ${cap.title} ${cap.desc} ${slug}`.toLowerCase().replace(/"/g, '');
      return `
      <figure class="card" data-search="${esc(search)}">
        <a class="shot" href="${shot}" target="_blank" rel="noopener">
          <img loading="lazy" src="${shot}" alt="${esc(cap.title)}">
        </a>
        <figcaption>
          <h3>${esc(cap.title)}</h3>
          <p>${esc(cap.desc)}</p>
        </figcaption>
      </figure>`;
    }).join('');
    return `
    <section class="sec" id="${s.id}" data-title="${esc(s.title.toLowerCase())}">
      <h2>${esc(s.title)}</h2>
      <p class="intro">${esc(s.intro)}</p>
      <div class="grid">${cards}</div>
    </section>`;
  }).join('');

  const tokenCss = Object.entries(tok).map(([k, val]) => `      ${k}: ${val};`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sheaf — visual guide</title>
<style>
  :root {
${tokenCss}
    --maxw: 1180px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font-family: ${v('--font', 'system-ui, sans-serif')};
    line-height: 1.5; -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header.top {
    border-bottom: 1px solid var(--panel-border);
    background: linear-gradient(180deg, var(--bg-raised), var(--bg));
    padding: 40px 24px 28px;
  }
  header.top .wrap { max-width: var(--maxw); margin: 0 auto; }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .brand b { font-size: 30px; letter-spacing: -.01em; }
  .brand .ver { color: var(--fg-faint); font-size: 14px; }
  .tagline { color: var(--fg-muted); font-size: 16px; max-width: 70ch; margin: 10px 0 0; }
  .privacy { display: inline-flex; gap: 8px; align-items: center; margin-top: 16px;
    font-size: 13px; color: var(--fg-faint); border: 1px solid var(--panel-border);
    background: var(--bg-sunken); padding: 7px 12px; border-radius: var(--r-md); }
  .privacy b { color: var(--ok); font-weight: 600; }

  .searchbar { position: sticky; top: 0; z-index: 20;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px); border-bottom: 1px solid var(--panel-border); }
  .searchbar .wrap { max-width: var(--maxw); margin: 0 auto; padding: 12px 24px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  #q { flex: 1; min-width: 220px; font: inherit; font-size: 15px; color: var(--fg);
    background: var(--bg-sunken); border: 1px solid var(--panel-border);
    border-radius: var(--r-md); padding: 10px 14px; outline: none; }
  #q:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .searchbar .hint { color: var(--fg-faint); font-size: 12px; }
  .searchbar .hint kbd { font-family: var(--mono); background: var(--bg-sunken);
    border: 1px solid var(--panel-border); border-radius: 5px; padding: 1px 6px; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 8px; }
  nav.toc a { font-size: 13px; color: var(--fg-muted); border: 1px solid var(--panel-border);
    background: var(--bg-raised); padding: 5px 11px; border-radius: 999px; }
  nav.toc a:hover { color: var(--fg); border-color: var(--accent); text-decoration: none; }

  main { max-width: var(--maxw); margin: 0 auto; padding: 8px 24px 80px; }
  .sec { padding-top: 36px; scroll-margin-top: 76px; }
  .sec > h2 { font-size: 22px; margin: 0 0 4px; letter-spacing: -.01em; }
  .sec .intro { color: var(--fg-muted); margin: 0 0 20px; max-width: 75ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 22px; }

  figure.card { margin: 0; border: 1px solid var(--panel-border); border-radius: var(--r-lg);
    overflow: hidden; background: var(--panel); display: flex; flex-direction: column;
    transition: border-color .15s, transform .15s; }
  figure.card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .card .shot { display: block; background: var(--canvas-bg); border-bottom: 1px solid var(--panel-border); }
  .card .shot img { display: block; width: 100%; height: auto; }
  .card figcaption { padding: 14px 16px 16px; }
  .card h3 { margin: 0 0 6px; font-size: 15px; }
  .card p { margin: 0; color: var(--fg-muted); font-size: 13.5px; }

  .nomatch { display: none; color: var(--fg-muted); padding: 40px 4px; font-size: 15px; }
  .nomatch.show { display: block; }
  .sec.hidden, figure.card.hidden { display: none; }

  footer { max-width: var(--maxw); margin: 0 auto; padding: 24px; border-top: 1px solid var(--panel-border);
    color: var(--fg-faint); font-size: 13px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
</style>
</head>
<body>
  <header class="top">
    <div class="wrap">
      <div class="brand"><b>Sheaf</b> <span class="ver">visual guide</span></div>
      <p class="tagline">A browser-native PDF editor in a single HTML file — tool one of the Bench suite. Every screen below was captured from the running app. Open, edit, redact, sign, and save your PDF without it ever leaving your machine.</p>
      <div class="privacy">🌙 <span><b>No account · no upload · no telemetry · works offline.</b> Your document is opened off disk, edited in the tab, and saved back.</span></div>
    </div>
  </header>

  <div class="searchbar">
    <div class="wrap">
      <input id="q" type="search" placeholder="Search features — try “redact”, “sign”, “OCR”…" autocomplete="off" aria-label="Search the guide">
      <span class="hint"><kbd>/</kbd> to search · <kbd>Esc</kbd> to clear</span>
      <nav class="toc">${tocItems}</nav>
    </div>
  </div>

  <main>
    <p class="nomatch" id="nomatch">No features match that search.</p>
    ${sectionsHtml}
  </main>

  <footer>
    <span>Sheaf — open it at <a href="${GUIDE_BASE}index.html">../index.html</a></span>
    <span>This guide is generated — edit <code>guide/build_index.mjs</code>, not this file.</span>
  </footer>

  <script>
    const q = document.getElementById('q');
    const cards = [...document.querySelectorAll('figure.card')];
    const secs = [...document.querySelectorAll('section.sec')];
    const nomatch = document.getElementById('nomatch');
    function apply() {
      const term = q.value.trim().toLowerCase();
      let any = false;
      for (const c of cards) {
        const hit = !term || c.dataset.search.includes(term);
        c.classList.toggle('hidden', !hit);
        if (hit) any = true;
      }
      for (const s of secs) {
        const visible = s.querySelector('figure.card:not(.hidden)');
        s.classList.toggle('hidden', !visible);
      }
      nomatch.classList.toggle('show', !any);
    }
    q.addEventListener('input', apply);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
      else if (e.key === 'Escape') { q.value = ''; apply(); q.blur(); }
    });
  </script>
</body>
</html>
`;

  writeFileSync(join(HERE, 'index.html'), html);
  const count = SECTIONS.reduce((n, s) => n + s.items.length, 0) - missing.length;
  if (missing.length) console.warn(`  ⚠ no screenshot for: ${missing.join(', ')}`);
  console.log(`✓ guide/index.html — ${SECTIONS.length} sections, ${count} feature cards`);
}

build();
