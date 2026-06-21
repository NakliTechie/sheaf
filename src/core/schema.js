// schema.js — the ONE ingress. Every byte and every param from outside the app
// passes through here before the core touches it. One door, and it checks coats.
//
// Two jobs:
//   1. validateParams(schema, input)  — coerce + validate operation params
//   2. validatePdfBytes(bytes)        — sanity-gate an incoming PDF before parsing
//
// The param schema is a deliberately small descriptor — not JSON Schema — so it
// stays inspectable by the agent face and the Bench conductor (they read these to
// know what each op accepts). Keep it boring.

// A field descriptor: { type, required?, default?, min?, max?, enum?, items?, of? }
//   type: 'int' | 'number' | 'string' | 'bool' | 'array' | 'object' | 'bytes' | 'any'
//   items: for 'array', a field descriptor each element must satisfy
//   of:    for 'object', a { key: descriptor } map

export class ValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors || [];
  }
}

function fail(errors, path, msg) {
  errors.push(`${path || '(root)'}: ${msg}`);
}

function coerceField(desc, value, path, errors) {
  // Apply default for undefined/null
  if (value === undefined || value === null) {
    if (desc.default !== undefined) return typeof desc.default === 'function' ? desc.default() : desc.default;
    if (desc.required) { fail(errors, path, 'required'); return undefined; }
    return undefined;
  }

  switch (desc.type) {
    case 'int': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.trunc(n) !== n) { fail(errors, path, `expected integer, got ${JSON.stringify(value)}`); return undefined; }
      if (desc.min !== undefined && n < desc.min) { fail(errors, path, `must be >= ${desc.min}`); return undefined; }
      if (desc.max !== undefined && n > desc.max) { fail(errors, path, `must be <= ${desc.max}`); return undefined; }
      return n;
    }
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) { fail(errors, path, `expected number, got ${JSON.stringify(value)}`); return undefined; }
      if (desc.min !== undefined && n < desc.min) { fail(errors, path, `must be >= ${desc.min}`); return undefined; }
      if (desc.max !== undefined && n > desc.max) { fail(errors, path, `must be <= ${desc.max}`); return undefined; }
      return n;
    }
    case 'string': {
      if (typeof value !== 'string') { fail(errors, path, `expected string`); return undefined; }
      if (desc.enum && !desc.enum.includes(value)) { fail(errors, path, `must be one of ${desc.enum.join(', ')}`); return undefined; }
      if (desc.maxLength !== undefined && value.length > desc.maxLength) { fail(errors, path, `too long (max ${desc.maxLength})`); return undefined; }
      return value;
    }
    case 'bool': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      fail(errors, path, 'expected boolean'); return undefined;
    }
    case 'array': {
      if (!Array.isArray(value)) { fail(errors, path, 'expected array'); return undefined; }
      if (desc.minItems !== undefined && value.length < desc.minItems) { fail(errors, path, `needs >= ${desc.minItems} items`); return undefined; }
      if (!desc.items) return value;
      return value.map((v, i) => coerceField(desc.items, v, `${path}[${i}]`, errors));
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) { fail(errors, path, 'expected object'); return undefined; }
      if (!desc.of) return value;
      const out = {};
      for (const [k, d] of Object.entries(desc.of)) out[k] = coerceField(d, value[k], path ? `${path}.${k}` : k, errors);
      return out;
    }
    case 'bytes': {
      if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) { fail(errors, path, 'expected bytes'); return undefined; }
      return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    }
    case 'any':
    default:
      return value;
  }
}

// Validate + coerce a params object against a { key: descriptor } schema.
// Throws ValidationError on any failure; returns the coerced object on success.
export function validateParams(schema, input) {
  const errors = [];
  const out = {};
  const src = input || {};
  for (const [key, desc] of Object.entries(schema || {})) {
    out[key] = coerceField(desc, src[key], key, errors);
  }
  if (errors.length) throw new ValidationError(`Invalid parameters: ${errors.join('; ')}`, errors);
  return out;
}

// Gate incoming PDF bytes before any engine parses them. Cheap structural checks
// only — the real parse happens in the doc adapter, but this catches obvious
// non-PDF / truncated input at the single ingress and fails loud.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function validatePdfBytes(input, { maxBytes = 0 } = {}) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array)) throw new ValidationError('Not a byte buffer');
  if (bytes.length < 32) throw new ValidationError('Too small to be a PDF');
  if (maxBytes && bytes.length > maxBytes) throw new ValidationError(`Exceeds size limit (${bytes.length} > ${maxBytes})`);
  // Header may sit within the first 1KB (some PDFs have a leading BOM / junk).
  let headerAt = -1;
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let i = 0; i <= limit; i++) {
    let ok = true;
    for (let j = 0; j < PDF_MAGIC.length; j++) { if (bytes[i + j] !== PDF_MAGIC[j]) { ok = false; break; } }
    if (ok) { headerAt = i; break; }
  }
  if (headerAt === -1) throw new ValidationError('Missing %PDF- header — not a PDF');
  return bytes;
}
