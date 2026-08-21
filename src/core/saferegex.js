// saferegex.js — a proportionate guard for regex sources that arrive from OUTSIDE the app
// (the AI sidecar's describe-to-redact returns model-authored patterns we then run over
// every text item). It is not a full ReDoS analyzer; it rejects the length/shape that make
// catastrophic backtracking easy, before the pattern is ever compiled or executed.

// The classic catastrophic shape: a group or char-class that itself contains an unbounded
// quantifier, and is then quantified again — (a+)+ , (a*)* , (.+)+ , [a-z]+)* and friends.
const NESTED_QUANTIFIER = /(\([^)]*[+*][^)]*\)|\[[^\]]*\][+*])\s*[+*]/;

// A single source is safe to compile+run when it is a non-empty, bounded-length string with
// no nested-unbounded-quantifier shape.
export function isSafeRegexSource(src, { maxLength = 200 } = {}) {
  return typeof src === 'string'
    && src.length > 0
    && src.length <= maxLength
    && !NESTED_QUANTIFIER.test(src);
}

// Compile up to `maxPatterns` safe sources into RegExp objects; silently drops unsafe or
// uncompilable ones. Returns the compiled list (order preserved).
export function compileSafeRegexes(sources, { flags = 'gi', maxPatterns = 25, maxLength = 200 } = {}) {
  const list = Array.isArray(sources) ? sources.slice(0, maxPatterns) : [];
  return list
    .map(src => {
      if (!isSafeRegexSource(src, { maxLength })) return null;
      try { return new RegExp(src, flags); } catch { return null; }
    })
    .filter(Boolean);
}
