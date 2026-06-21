// app.js — bootstrap. Probe → prefs → error net → register ops → init UI → wire the
// keyboard grammar + agent face → URL mode. The deterministic core is already proven
// headlessly (test/m0-replay.mjs); this wires the human face on top of it.

import { setEnginesBase } from './core/engines.js';
import { loadPrefs, state } from './core/state.js';
import { on } from './core/events.js';
import { registerOps } from './ops/index.js';
import { keyboard } from './core/keyboard.js';
import { undo, redo } from './core/runner.js';
import { refreshAgentFace, handleUrlMode } from './core/agent.js';
import { init as initAi } from './core/ai.js';

import { installErrorNet } from './ui/toast.js';
import { initToolbar } from './ui/toolbar.js';
import { initStatusbar } from './ui/statusbar.js';
import { initRenderDoc } from './ui/rendoc.js';
import { initViewer, zoomBy, setFitMode, scrollToPage } from './ui/viewer.js';
import { initThumbs } from './ui/thumbs.js';
import { initAnnotateTools, setTool } from './ui/annotate-tools.js';
import { initWelcome } from './ui/welcome.js';
import { initRecovery } from './ui/recovery.js';
import { openPdf, savePdf, savePdfAs, openFolder, nextFile, prevFile } from './ui/fileops.js';
import { openHelp } from './ui/help.js';

function probe() {
  const ok = typeof crypto !== 'undefined' && crypto.subtle && 'indexedDB' in window;
  if (!ok) document.getElementById('compat')?.classList.add('show');
  return ok;
}

function wireKeyboard() {
  let modalOpen = false;
  on('modal:open', () => { modalOpen = true; });
  on('modal:close', () => { modalOpen = false; });
  keyboard.setContextResolver(() => modalOpen ? ['__modal__'] : (state.doc ? ['viewer'] : ['global']));

  keyboard
    .register('mod+o', () => openPdf(), { context: 'global', label: 'Open' })
    .register('mod+shift+o', () => openFolder(), { context: 'global', label: 'Open folder' })
    .register('mod+s', () => savePdf(), { context: 'global', label: 'Save' })
    .register('mod+shift+s', () => savePdfAs(), { context: 'global', label: 'Save as' })
    .register(']', () => nextFile(), { context: 'viewer', label: 'Next PDF (folder mode)' })
    .register('[', () => prevFile(), { context: 'viewer', label: 'Previous PDF (folder mode)' })
    .register('mod+z', () => undo(), { context: 'global', label: 'Undo' })
    .register('mod+shift+z', () => redo(), { context: 'global', label: 'Redo' })
    .register('?', () => openHelp(), { context: 'global', label: 'Help' })
    .register('+', () => zoomBy(1.2), { context: 'viewer', label: 'Zoom in' })
    .register('=', () => zoomBy(1.2), { context: 'viewer' })
    .register('-', () => zoomBy(1 / 1.2), { context: 'viewer', label: 'Zoom out' })
    .register('0', () => setFitMode('width'), { context: 'viewer', label: 'Fit width' })
    .register('arrowdown', () => scrollToPage(Math.min(state.view.pageIndex + 1, state.doc.pageCount() - 1)), { context: 'viewer' })
    .register('arrowup', () => scrollToPage(Math.max(state.view.pageIndex - 1, 0)), { context: 'viewer' })
    // Annotation tools (bare keys, viewer context, suppressed while typing).
    .register('v', () => setTool(null), { context: 'viewer', label: 'Select' })
    .register('h', () => setTool('highlight'), { context: 'viewer', label: 'Highlight' })
    .register('r', () => setTool('rect'), { context: 'viewer', label: 'Rectangle' })
    .register('l', () => setTool('line'), { context: 'viewer', label: 'Line' })
    .register('d', () => setTool('pencil'), { context: 'viewer', label: 'Draw' })
    .register('t', () => setTool('text'), { context: 'viewer', label: 'Text box' })
    .register('e', () => setTool('edittext'), { context: 'viewer', label: 'Edit text' })
    .register('w', () => setTool('whiteout'), { context: 'viewer', label: 'Whiteout' })
    .register('x', () => setTool('redact'), { context: 'viewer', label: 'Redact' })
    .register('escape', () => setTool(null), { context: 'viewer' })
    .attach(window);
}

function wireLoadingBar() {
  const bar = document.getElementById('loading-bar');
  on('loading', ({ on: active }) => {
    if (!bar) return;
    if (active) { bar.style.width = '70%'; }
    else { bar.style.width = '100%'; setTimeout(() => { bar.style.width = '0'; }, 220); }
  });
}

function boot() {
  if (!probe()) return;
  // Engines live one level up from /src in dev; the build rewrites this to './engines'.
  setEnginesBase(new URL('../engines', import.meta.url).pathname);
  loadPrefs();
  if (!document.documentElement.getAttribute('data-theme')) document.documentElement.setAttribute('data-theme', 'dark');
  installErrorNet();
  wireLoadingBar();

  registerOps();

  initRenderDoc();
  initViewer();
  initThumbs();
  initAnnotateTools();
  initStatusbar();
  initToolbar();
  initWelcome();

  wireKeyboard();
  initRecovery();
  refreshAgentFace();
  handleUrlMode();
  // Detect the AI ladder in the background (probes localhost; quiet if nothing's there).
  // The tool is fully usable before/without this — the no-AI ground floor.
  initAi().catch(() => {});

  console.log('[sheaf] ready —', document.getElementById('app').dataset.version);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
