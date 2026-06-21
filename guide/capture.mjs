// capture.mjs — drive the built Sheaf in a real (headless) browser and screenshot
// every feature surface. Sheaf is single-role, so this is one route-plan over the
// app's features rather than per-role plans. The document is loaded and operated
// through Sheaf's own agent face (window.sheaf), the same door the UI dispatches
// through — so every visible change in a shot is a real, deterministic op result,
// not a mock. Menus/dialogs all mount into #modal-root as .modal; clicking the
// toolbar button that opens one and waiting for .modal is the whole pattern.
//
// Output: guide/screenshots/feature/NN-slug.png (retina) + guide/CAPTURE-LOG.md.
// Run via guide/regenerate.sh (ensures server + build first). Standalone:
//   BASE=http://127.0.0.1:8791 node guide/capture.mjs

import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots', 'feature');
const SEED = join(HERE, 'seed', 'demo.pdf');
const BASE = process.env.BASE || 'http://127.0.0.1:8791';

// ── resolve Playwright (local dep → global install) ──────────────────────────────
function resolvePlaywright() {
  try { return require.resolve('playwright'); } catch {}
  try {
    const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require.resolve('playwright', { paths: [g] });
  } catch {}
  return null;
}
const pwEntry = resolvePlaywright();
if (!pwEntry) {
  console.error('✗ Playwright not found. Install once:  npm i -g playwright && npx playwright install chromium');
  process.exit(2);
}
const pw = await import(pathToFileURL(pwEntry).href);
const chromium = pw.chromium || pw.default?.chromium;

// ── route-plan: ordered feature shots. Each prep() leaves the app in the state the
//    shot should capture; the harness screenshots after a settle. ────────────────
// 1600 wide so the full toolbar fits without horizontal overflow (the toolbar's
// ~30 controls intrinsically need ~1562px; below that #app scrolls horizontally
// and can carry the thumbnail rail off-frame — see normalizeFrame + CAPTURE-LOG).
const VIEWPORT = { width: 1600, height: 900 };
const seedBytes = [...readFileSync(SEED)]; // plain array → rebuilt as Uint8Array in-page

const STEPS = [
  { slug: 'welcome', doc: false, prep: async () => {} },

  { slug: 'editor', prep: async (c) => { await c.loadSeed(); await c.scrollToPage(0); } },

  // Rotate page 2 to show the result, then undo in cleanup — a rotated (landscape)
  // page is wider than the viewport and would otherwise scroll the thumbnail rail
  // out of frame in every later shot, and leave the redact page sideways.
  { slug: 'pages', prep: async (c) => {
      await c.run('pages.rotate', { pages: [1], angle: 90 });
      await c.scrollToPage(1);
    }, cleanup: async (c) => { await c.undo(); } },

  { slug: 'annotate', prep: async (c) => {
      await c.run('annotate.highlight', { page: 0, x: 0.10, y: 0.455, w: 0.55, h: 0.024, color: '#ffe14d' });
      await c.run('annotate.rect', { page: 0, x: 0.085, y: 0.435, w: 0.60, h: 0.115, color: '#5b8cff', thickness: 2 });
      await c.scrollToPage(0);
      await c.tool('Highlight');
    } },

  { slug: 'edit-text', prep: async (c) => { await c.scrollToPage(0); await c.tool('Edit text (click a line)'); } },

  { slug: 'whiteout', prep: async (c) => {
      await c.run('text.whiteout', { page: 2, x: 0.10, y: 0.285, w: 0.62, h: 0.030, text: '(updated figure pending review)', fontSize: 12, textColor: '#1a1d23' });
      await c.scrollToPage(2);
      await c.tool('Whiteout & retype');
    } },

  { slug: 'redact', prep: async (c) => {
      await c.run('redact.region', { page: 1, x: 0.10, y: 0.476, w: 0.64, h: 0.030 });
      await c.scrollToPage(1);
      await c.tool('Redact (true removal)');
    } },

  { slug: 'sign', prep: async (c) => {
      await c.scrollToPage(3);
      await c.tool('Sign');
      await c.clickPageCanvas(3);       // sign-tool pointerdown opens the signature chooser
      await c.waitModal();
    }, closeAfter: true },

  { slug: 'marks',    prep: async (c) => { await c.openMenu('mark'); }, closeAfter: true },
  { slug: 'forms',    prep: async (c) => { await c.openMenu('forms'); }, closeAfter: true },
  { slug: 'ocr',      prep: async (c) => { await c.openMenu('ocr'); }, closeAfter: true },
  { slug: 'convert',  prep: async (c) => { await c.openMenu('Convert / Export'); }, closeAfter: true },
  { slug: 'metadata', prep: async (c) => { await c.openMenu('info'); }, closeAfter: true },
  { slug: 'save',     prep: async (c) => { await c.openMenu('Save options'); }, closeAfter: true },
  { slug: 'ai',       prep: async (c) => { await c.openMenu('ai'); }, closeAfter: true },
  { slug: 'settings', prep: async (c) => { await c.openMenu('settings'); }, closeAfter: true },
  { slug: 'help',     prep: async (c) => { await c.openMenu('help'); }, closeAfter: true },

  { slug: 'light-theme', prep: async (c) => { await c.clearTool(); await c.clickById('btn-theme'); await c.scrollToPage(0); } },
];

// ── harness ───────────────────────────────────────────────────────────────────────
const log = [];
let consoleErrors = [];

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  // Enable the agent face + pin the dark theme BEFORE the app boots (loadPrefs reads this).
  await context.addInitScript(() => {
    try { localStorage.setItem('sheaf.v1.prefs', JSON.stringify({ theme: 'dark', agentFace: true, viewMode: 'continuous', fitMode: 'width' })); } catch {}
  });
  const page = await context.newPage();

  let curSlug = '(boot)';
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${curSlug}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${curSlug}] pageerror: ${e.message}`));

  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => !!window.sheaf, { timeout: 20_000 });

  const c = makeCtx(page);
  let n = 0;
  for (const step of STEPS) {
    curSlug = step.slug;
    n += 1;
    const nn = String(n).padStart(2, '0');
    try {
      await step.prep(c);
      await c.settle();
      if (step.doc !== false) {
        const canvases = await page.$$eval('.page-wrap canvas', (els) => els.length);
        if (canvases === 0) throw new Error('no page canvas rendered');
      }
      const overflow = await c.normalizeFrame();
      // Flag only real layout overflow; a rotated (landscape) page is legitimately a
      // touch wider than the viewport, so ignore small amounts.
      if (overflow.by > 40) consoleErrors.push(`[${curSlug}] horizontal overflow ${overflow.by}px (${overflow.who})`);
      const file = join(OUT, `${nn}-${step.slug}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const size = statSync(file).size;
      const ok = size > 25_000;
      log.push(`${ok ? 'ok  ' : 'THIN'} ${nn}-${step.slug}.png  (${(size / 1024).toFixed(0)} KB)`);
      if (!ok) console.warn(`  ⚠ ${step.slug} screenshot is suspiciously small (${size} B)`);
      else console.log(`  ✓ ${nn}-${step.slug}`);
    } catch (err) {
      log.push(`FAIL ${nn}-${step.slug}  — ${err.message}`);
      console.error(`  ✗ ${step.slug}: ${err.message}`);
    }
    if (step.closeAfter) await c.closeModal();
    if (step.cleanup) { try { await step.cleanup(c); } catch (err) { console.warn(`  ⚠ ${step.slug} cleanup: ${err.message}`); } }
  }

  await browser.close();
  writeCaptureLog(n);
}

function makeCtx(page) {
  const settle = async (ms = 700) => {
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await page.waitForTimeout(ms);
  };
  return {
    settle,
    run: async (id, params) => {
      const res = await page.evaluate(async ({ id, params }) => {
        try { await window.sheaf.run(id, params); return null; }
        catch (e) { return e.message || String(e); }
      }, { id, params });
      if (res) throw new Error(`op ${id} failed: ${res}`);
      await settle(350);
    },
    loadSeed: async () => {
      const res = await page.evaluate(async (arr) => {
        try { await window.sheaf.run('open.bytes', { bytes: new Uint8Array(arr) }); return null; }
        catch (e) { return e.message || String(e); }
      }, seedBytes);
      if (res) throw new Error(`open.bytes failed: ${res}`);
      await page.waitForSelector('.page-wrap canvas', { timeout: 15_000 });
      await settle(700);
    },
    scrollToPage: async (i) => {
      await page.evaluate((idx) => {
        const w = document.querySelector(`.page-wrap[data-page="${idx}"]`);
        if (w) w.scrollIntoView({ block: 'center' });
      }, i);
      await settle(450);
    },
    tool: async (title) => { await page.click(`button[title="${title}"]`); await settle(300); },
    clearTool: async () => { await page.click('button[title="Select"]'); await settle(200); },
    undo: async () => { await page.evaluate(async () => { await window.sheaf.undo(); }); await settle(450); },
    // Consistent framing: zero any horizontal scroll so the thumbnail rail is always
    // in-frame, and report whatever element is widest than its container (diagnostic).
    normalizeFrame: async () => page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      let who = 'document', by = root.scrollWidth - root.clientWidth;
      for (const sel of ['#app', '#body', '#viewport', '#rail', '.rail', '#main']) {
        const elm = document.querySelector(sel);
        if (!elm) continue;
        elm.scrollLeft = 0;
        const o = elm.scrollWidth - elm.clientWidth;
        if (o > by) { by = o; who = sel; }
      }
      root.scrollLeft = 0; window.scrollTo(0, window.scrollY);
      return { by, who };
    }),
    openMenu: async (title) => {
      await page.click(`button[title="${title}"]`);
      await page.waitForSelector('#modal-root.open .modal', { timeout: 6_000 });
      await settle(350);
    },
    waitModal: async () => { await page.waitForSelector('#modal-root.open .modal', { timeout: 6_000 }); await settle(350); },
    clickById: async (id) => { await page.click(`#${id}`); await settle(300); },
    clickPageCanvas: async (i) => {
      const box = await page.$eval(`.page-wrap[data-page="${i}"] canvas`, (el) => {
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.5);
    },
    closeModal: async () => {
      await page.keyboard.press('Escape');
      await page.waitForSelector('#modal-root.open', { state: 'detached', timeout: 4_000 }).catch(() => {});
      await settle(200);
    },
  };
}

function writeCaptureLog(total) {
  const okCount = log.filter((l) => l.startsWith('ok')).length;
  const body = [
    `# Sheaf guide — capture log`,
    ``,
    `${okCount}/${total} feature shots rendered ok · ${consoleErrors.length} console error(s)`,
    ``,
    `## Shots`,
    ...log.map((l) => `- ${l}`),
    ``,
    `## Console errors`,
    consoleErrors.length ? consoleErrors.map((e) => `- ${e}`).join('\n') : '- none',
    ``,
  ].join('\n');
  writeFileSync(join(HERE, 'CAPTURE-LOG.md'), body);
  console.log(`\n${okCount}/${total} ok · ${consoleErrors.length} console error(s) → guide/CAPTURE-LOG.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
