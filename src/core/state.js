// state.js — the single document-state shape + UI preferences.
//
// One mutable `state` object the whole app reads. The open document is a SheafDoc
// (or null). History is the op-log. Preferences persist to localStorage — and ONLY
// preferences: never PDF content, page bytes, extracted text, or form values. Document
// bytes live in memory and, transiently, in OPFS crash-staging (ui/recovery.js, cleared
// on save/close) — never durably persisted, and never written here.

import { History } from './history.js';
import { emit, on } from './events.js';

export const state = {
  session: {
    source: null,        // 'fsa' | 'picker' | 'dragdrop' | 'url' | 'restore' | null
    fileHandle: null,    // FileSystemFileHandle when opened via FSA (for save-in-place)
    folderHandle: null,  // FileSystemDirectoryHandle for folder mode / sidecar saves
    fileName: null,      // pinned on first save; never re-derived from a mutable title
    files: [],           // folder mode: [{ handle, name, size }]
    currentIndex: 0,
  },
  doc: null,             // SheafDoc | null — the open document object
  view: {
    pageIndex: 0,        // active page (paginated mode) / scroll anchor (continuous)
    zoom: 1.0,
    fitMode: 'width',    // 'width' | 'page' | 'actual' | 'custom'
    mode: 'continuous',  // 'continuous' | 'paginated'
  },
  selection: {
    pages: [],           // selected page indices (thumbnail multi-select)
    region: null,        // { page, x, y, w, h } in PDF units — for redact/annotate
  },
  activeTool: null,
  history: new History(),
  dirty: false,          // unsaved changes since last save/open
  dev: {
    agentFace: false,    // window.sheaf is OFF by default — opt-in developer setting
  },
};

// ── Preferences (localStorage; UI only) ────────────────────────────────────────

const PREFS_KEY = 'sheaf.v1.prefs';

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
    if (p.viewMode === 'continuous' || p.viewMode === 'paginated') state.view.mode = p.viewMode;
    if (typeof p.fitMode === 'string') state.view.fitMode = p.fitMode;
    if (typeof p.agentFace === 'boolean') state.dev.agentFace = p.agentFace;
  } catch {}
}

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      viewMode: state.view.mode,
      fitMode: state.view.fitMode,
      agentFace: state.dev.agentFace,
    }));
  } catch {}
}

// ── Document lifecycle ─────────────────────────────────────────────────────────

// Install a freshly-opened document. Resets view/selection/history — a new file is
// a clean slate.
export function setDoc(doc, { fileName = null, fileHandle = null, folderHandle = null, source = null } = {}) {
  state.doc = doc;
  state.session.fileName = fileName;
  state.session.fileHandle = fileHandle;
  if (folderHandle !== undefined) state.session.folderHandle = folderHandle ?? state.session.folderHandle;
  state.session.source = source;
  state.view.pageIndex = 0;
  state.selection = { pages: [], region: null };
  state.activeTool = null;
  state.history.clear();
  state.dirty = false;
  emit('doc:loaded', { fileName, pageCount: doc ? doc.pageCount() : 0 });
}

export function closeDoc() {
  state.doc = null;
  state.session = { source: null, fileHandle: null, folderHandle: null, fileName: null, files: [], currentIndex: 0 };
  state.history.clear();
  state.dirty = false;
  emit('doc:closed', null);
}

export function markDirty(v = true) {
  if (state.dirty === v) return;
  state.dirty = v;
  emit('dirty:changed', { dirty: v });
}

on('prefs:save', () => savePrefs());
