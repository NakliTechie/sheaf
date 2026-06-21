# Sheaf

> Browser-native PDF editor. One HTML file. Every operation. Your document, your disk. No account, no upload, no telemetry, no limits — and an agent face none of the others have.

**Status:** v0.1 spec · pre-build · 2026-06-21
**Deploy target:** sheaf.naklitechie.com (static host)
**Suite:** Bench creative suite — **tool 1 of 5** (Sheaf → vector → audio → layout → compositor)

Sheaf is a single-HTML-file PDF editor that opens a PDF straight off the user's
filesystem and performs the full document-model toolset — merge, split, reorder,
sign, redact, fill, OCR, annotate, compress, convert — entirely in the browser.
No server, no account, no upload, no watermark, no daily cap, no telemetry. The
PDF never leaves the device. The exported file is a published open standard that
replays without Sheaf and without any model.

It is the **document-model** half of the suite's raster/document split: Slate
(shipped image editor) treats a PDF page as a *pixel surface*; Sheaf treats a PDF
as a *document object* — pages, the AcroForm tree, the text layer, signatures,
metadata, the xref table.

## Posture (non-negotiable)

- One self-contained HTML file. No build step, no server, no account, ever.
- No telemetry, analytics, or error reporting, ever. No PDF content persisted or
  uploaded — except, under BYOK, the minimum slice to the user's *own* provider.
- Redaction is **true content-stream removal**, never a black box over live text.
- The AI sidecar is a **removable passenger** — pull it out and every operation
  still works. The no-AI state is the ground floor.
- **One core, three doors:** click (human UI) · call (`window.sheaf` agent face) ·
  brief (Bench conductor) — all dispatch through the same operation registry.

## Stack

Vanilla JS · PDF.js (render/text-layer/search) · pdf-lib (default write engine) ·
Tesseract.js (OCR) · pdfium-wasm (optional fidelity tier). All engines vendored
same-origin, lazy-loaded on first use, version-pinned and SHA-256 verified.

Rides three suite primitives — `nakli-doc`, `nakli-creative-primitives`,
`nakli-ai` — and, as tool 1 of 5, hardens them for the tools that follow.

## Architecture

One operation registry is the spine: every edit — page op, annotation, redaction,
OCR, metadata — registers once and dispatches through one path, whether it's driven by
the human UI (click), the agent face (`window.sheaf` / URL mode — off by default), or
the Bench conductor (brief). The deterministic core gates everything; the AI sidecar is
a removable passenger.

- `src/core/` — registry, runner (dispatch + op-log replay), single schema ingress,
  the `nakli-doc` PDF adapter (pdf-lib write side + PDF.js render side), storage façade,
  keyboard grammar, the `nakli-ai` sidecar, engine loader.
- `src/ops/` — every operation (open, page ops, annotate, marks, text, forms, sign,
  redact, OCR, convert, metadata).
- `src/ui/` — the human face. `build/inline.mjs` bundles `src/` into a single
  `index.html`; engines are vendored, SHA-pinned, and loaded same-origin from `/engines`.

Run the tests with `npm test`; build with `npm run build`.

## License

[GNU AGPL-3.0](LICENSE) — derivatives and hosted forks stay open.

---

Part of [NakliTechie](https://naklitechie.com).
