#!/usr/bin/env node
// build/inline.mjs — Sheaf's single-file build. Bundles src/ (native ESM) into one
// self-contained index.html at the repo root, served alongside /engines. NO runtime
// deps, NO bundler — this is a ~230-line Node-stdlib inliner (suite convention, lifted
// from Slate). The shipped file fetches nothing but its vendored, SHA-pinned engines.
//
//   node build/inline.mjs
//
// What it does: topologically bundle the module graph from app.js (each module wrapped
// in an IIFE returning its exports), inline the CSS, rewrite the engines base to
// './engines', stamp the version, and emit index.html + _headers.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

// ── CSS ─────────────────────────────────────────────────────────────────────────
function collectCss(dir) {
  const files = [];
  for (const f of readdirSync(dir, { recursive: true })) {
    const full = join(dir, f);
    if (statSync(full).isFile() && f.endsWith('.css')) files.push(full);
  }
  // theme before layout (tokens first).
  files.sort((a, b) => (a.includes('theme') ? -1 : b.includes('theme') ? 1 : a.localeCompare(b)));
  return files.map(f => `/* ${relative(SRC, f)} */\n${readFileSync(f, 'utf8')}`).join('\n\n');
}

// ── Module bundler (IIFE-wrap, topological) ───────────────────────────────────────
const order = [];
const bundled = new Map();

function varName(filePath) {
  return '__m_' + relative(SRC, filePath).replace(/\.m?js$/, '').replace(/[^a-zA-Z0-9]/g, '_');
}
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  if (spec.endsWith('.js') || spec.endsWith('.mjs')) return resolve(dirname(from), spec);
  return resolve(dirname(from), spec + '.js');
}
function parseImports(src) {
  const re = /^import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?$/gm;
  const out = []; let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}
function parseNamedImports(src) {
  const out = []; let m;
  const re = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?$/gm;
  while ((m = re.exec(src)) !== null) out.push({ clause: m[1], specifier: m[2], full: m[0] });
  const bare = /^import\s+['"]([^'"]+)['"]\s*;?$/gm;
  while ((m = bare.exec(src)) !== null) out.push({ clause: null, specifier: m[1], full: m[0] });
  return out;
}
function parseExports(src) {
  const pairs = []; const seen = new Set();
  const add = (local, exported) => { if (!seen.has(exported)) { seen.add(exported); pairs.push({ local, exported }); } };
  let m;
  const re1 = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm;
  while ((m = re1.exec(src)) !== null) add(m[1], m[1]);
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const c = part.trim(); if (!c) continue;
      const [local, exported] = c.split(/\s+as\s+/).map(s => s.trim());
      add(local, exported || local);
    }
  }
  return pairs;
}
function transformModule(filePath, src) {
  const vn = varName(filePath);
  let body = src;
  for (const info of parseNamedImports(src)) {
    const abs = resolveImport(filePath, info.specifier);
    if (!abs) continue;
    const depVar = varName(abs);
    let replacement = '';
    if (info.clause) {
      const clause = info.clause.trim();
      if (clause.startsWith('{')) {
        const inner = clause.slice(1, clause.lastIndexOf('}'));
        replacement = inner.split(',').map(p => {
          const [orig, alias] = p.trim().split(/\s+as\s+/);
          return `const ${(alias || orig).trim()} = ${depVar}.${orig.trim()};`;
        }).join('\n');
      } else if (clause.startsWith('*')) {
        replacement = `const ${clause.replace(/\*\s+as\s+/, '').trim()} = ${depVar};`;
      } else {
        replacement = `const ${clause} = ${depVar}.default ?? ${depVar};`;
      }
    }
    body = body.replace(info.full, replacement);
  }
  body = body
    .replace(/^export\s+default\s+/gm, 'const __default__ = ')
    .replace(/^export\s+(async\s+)?(function|class)\s+/gm, '$1$2 ')
    .replace(/^export\s+(const|let|var)\s+/gm, '$1 ')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '');
  const exports = parseExports(src);
  const retObj = exports.map(p => p.local === p.exported ? p.local : `${p.exported}: ${p.local}`).join(', ');
  return `/* ${relative(SRC, filePath)} */\nconst ${vn} = (() => {\n${body}\nreturn { ${retObj} };\n})();`;
}
function bundle(entry) {
  if (bundled.has(entry)) return;
  const src = readFileSync(entry, 'utf8');
  for (const spec of parseImports(src)) { const abs = resolveImport(entry, spec); if (abs) bundle(abs); }
  bundled.set(entry, true);
  order.push(entry);
}

// ── Build ─────────────────────────────────────────────────────────────────────────
bundle(join(SRC, 'app.js'));
let inlineJs = order.map(p => transformModule(p, readFileSync(p, 'utf8'))).join('\n\n');
// Single-file artifact: engines sit next to index.html at the deploy root.
inlineJs = inlineJs.replace("new URL('../engines', import.meta.url).pathname", "'./engines'");

const css = collectCss(SRC);
const template = readFileSync(join(SRC, 'index.html'), 'utf8');
const jsHash = createHash('sha256').update(inlineJs).digest('hex').slice(0, 12);

let html = template
  .replace(/<link rel="stylesheet" href="[^"]*">\s*/g, '')
  .replace(/<script type="module" src="[^"]*"><\/script>/, '')
  .replace(/content="0\.1\.0"/, `content="${VERSION}"`)
  .replace(/data-version="0\.1\.0"/, `data-version="${VERSION}"`)
  .replace('</head>', `<style>\n${css}\n</style>\n</head>`)
  .replace('</body>', `<script type="module">\n${inlineJs}\n</script>\n</body>`);

writeFileSync(join(ROOT, 'index.html'), html, 'utf8');

// Deploy headers (static host). The ONLY egress the app code performs is the AI
// sidecar's call to the user's own endpoint (BYOK https / localhost bridge); with no
// AI configured it makes no outbound calls at all. connect-src includes a broad https:
// because a static file cannot know the user's chosen provider host at build time — it
// is the deliberate, load-bearing enabler for remote BYOK. The blast radius is bounded
// by: SHA-256-pinned vendored engines (a swapped engine fails to load), no first-party
// backend to talk to, and app code that only ever POSTs to the configured endpoint.
// Local-only deployments can tighten connect-src to 'self' + localhost.
writeFileSync(join(ROOT, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'; base-uri 'self'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
`);

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✓ Built Sheaf v${VERSION} → index.html (${kb} KB shell, js ${jsHash}) + _headers`);
console.log(`  Engines load lazily from ./engines (vendored, SHA-pinned).`);
