// test/saferegex.mjs — the ReDoS guard for model-supplied regexes (M4). Untrusted pattern
// sources from the AI sidecar must be bounded and shape-checked before they run over text.

import { isSafeRegexSource, compileSafeRegexes } from '../src/core/saferegex.js';

let passed = 0, failed = 0;
const ok = (n, c) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${n}`); };

function main() {
  console.log('isSafeRegexSource — accepts real patterns, rejects dangerous ones');
  // Legitimate redaction patterns pass.
  ok('SSN pattern accepted', isSafeRegexSource('\\d{3}-\\d{2}-\\d{4}'));
  ok('email pattern accepted', isSafeRegexSource('[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'));
  ok('card pattern accepted', isSafeRegexSource('\\d{4} \\d{4} \\d{4} \\d{4}'));

  // Catastrophic-backtracking shapes rejected.
  ok('(a+)+ rejected', !isSafeRegexSource('(a+)+$'));
  ok('(a*)* rejected', !isSafeRegexSource('(a*)*'));
  ok('(.+)+ rejected', !isSafeRegexSource('(.+)+'));
  ok('[a-z]+* nested class rejected', !isSafeRegexSource('([a-z]+)*'));

  // Bounds.
  ok('empty rejected', !isSafeRegexSource(''));
  ok('over-long rejected', !isSafeRegexSource('a'.repeat(201)));
  ok('non-string rejected', !isSafeRegexSource(null) && !isSafeRegexSource(42));

  console.log('\ncompileSafeRegexes — caps count, drops unsafe, compiles the rest');
  const mixed = ['\\d{3}', '(a+)+', 'bad[', '[0-9]+', 'x'.repeat(300)];
  const compiled = compileSafeRegexes(mixed);
  ok('only the 2 safe+valid sources compiled', compiled.length === 2);
  ok('compiled entries are RegExp', compiled.every(r => r instanceof RegExp));

  const many = Array.from({ length: 100 }, (_, i) => `\\d{${(i % 5) + 1}}`);
  ok('count capped at 25', compileSafeRegexes(many).length === 25);

  // A dangerous source never yields a RegExp we would run.
  ok('dangerous source never compiled', compileSafeRegexes(['(x+)+y']).length === 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

main();
