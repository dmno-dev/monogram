// Smoke test for src/gen-lezer.ts — runs generateLezer on examples/typescript.ts
// and sanity-checks the three emitted artifacts. Run with: node test/lezer-smoke.ts
//
// Structural validation only (no toolchain required). If @lezer/generator happens
// to be installed, we additionally try buildParser() and report — but never block.

import { generateLezer } from '../src/gen-lezer.ts';

const grammar = (await import('../examples/typescript.ts')).default;
const out = generateLezer(grammar);

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('── gen-lezer smoke ──');

// 1. Non-empty grammar text with the core Lezer constructs.
check('grammar is non-empty', out.grammar.length > 200, `len=${out.grammar.length}`);
check('grammar has @top', out.grammar.includes('@top'));
check('grammar has @precedence block', /@precedence\s*\{/.test(out.grammar));
check('grammar has @tokens block', /@tokens\s*\{/.test(out.grammar));
check('grammar declares @skip for comments', out.grammar.includes('@skip'));
check('grammar has @external tokens (context-sensitive)', out.grammar.includes('@external tokens'));
check('grammar emits a rule per declared rule', grammar.rules.every(r => out.grammar.includes(`${r.name} {`) || out.grammar.includes(`${r.name} {\n`)),
  'some rule names missing from grammar text');
check('grammar maps precedence levels (l0..)', out.grammar.includes('l0') && out.grammar.includes(`l${grammar.precs.length - 1}`));
check('grammar uses !prec markers on operators', /!l\d/.test(out.grammar));
check('keywords are @specialize\'d over identifier', out.grammar.includes('@specialize'));

// 2. styleTags present and well-formed.
check('styleTags imports @lezer/highlight', out.styleTags.includes('from "@lezer/highlight"'));
check('styleTags({...}) call present', out.styleTags.includes('styleTags({'));
check('styleTags references tags via t.', /:\s*t\./.test(out.styleTags));
// Spot-check a few inferred mappings derived from gen-tm-style scope inference.
check('styleTags maps a keyword tag', /t\.(keyword|controlKeyword|definitionKeyword|modifier|operatorKeyword|moduleKeyword)/.test(out.styleTags));
check('styleTags maps strings', out.styleTags.includes('t.string'));
check('styleTags maps numbers', out.styleTags.includes('t.number'));
check('styleTags maps comments', /t\.(lineComment|blockComment|comment|docComment)/.test(out.styleTags));
check('styleTags maps a type/function name tag', /t\.(typeName|function\(|standard\()/.test(out.styleTags));

// 3. External tokenizer stub (JS) covering regex-vs-division + templates.
check('external tokenizer non-empty', out.externalTokenizer.length > 200);
check('external tokenizer imports ExternalTokenizer', out.externalTokenizer.includes('ExternalTokenizer'));
check('external tokenizer exports contextTokens (regex)', out.externalTokenizer.includes('export const contextTokens'));
check('external tokenizer uses divisionAfterTexts hint', out.externalTokenizer.includes('divisionAfterTexts'));
check('external tokenizer uses regexAfterTexts hint', out.externalTokenizer.includes('regexAfterTexts'));
check('external tokenizer has a template tokenizer', out.externalTokenizer.includes('export const templateTokens'));
check('external tokenizer marks incomplete spots', out.externalTokenizer.includes('INCOMPLETE'));

// 3b. The emitted external tokenizer must be syntactically valid JS. Strip the
//     ESM import (vm can't resolve modules) and compile the rest for a syntax check.
import vm from 'node:vm';
try {
  const body = out.externalTokenizer
    .replace(/^import\s.*$/m, '')
    .replace(/^export\s+const\s+/gm, 'const ');
  new vm.Script(body, { filename: 'tokens.js' });
  check('external tokenizer is valid JS (parses)', true);
} catch (e) {
  check('external tokenizer is valid JS (parses)', false, (e as Error).message.slice(0, 120));
}

// 4. incomplete diagnostics surfaced.
check('incomplete diagnostics array populated', out.incomplete.length > 0, 'expected at least the Pratt-mapping note');
check('incomplete mentions Pratt mapping', out.incomplete.some(s => /Pratt/i.test(s)));

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failing checks`);

// Show a small excerpt so a human can eyeball the output shape.
console.log('\n── grammar excerpt (first 40 lines) ──');
console.log(out.grammar.split('\n').slice(0, 40).join('\n'));
console.log('\n── styleTags excerpt (first 24 lines) ──');
console.log(out.styleTags.split('\n').slice(0, 24).join('\n'));
console.log('\n── incomplete notes ──');
for (const n of out.incomplete) console.log(`  - ${n}`);

// 5. Optional: try a real Lezer build if the toolchain is present (never blocks).
try {
  const mod = await import('@lezer/generator');
  const buildParser = (mod as { buildParser?: (text: string, opts?: unknown) => unknown }).buildParser;
  if (typeof buildParser === 'function') {
    try {
      buildParser(out.grammar, { externalTokenizer: () => null });
      console.log('\n@lezer/generator: buildParser succeeded.');
    } catch (e) {
      console.log(`\n@lezer/generator present but buildParser threw (expected — external tokens + hand-tuning needed):\n  ${(e as Error).message.slice(0, 200)}`);
    }
  }
} catch {
  console.log('\n@lezer/generator not installed — skipped real build (structural validation only).');
}

process.exit(failures === 0 ? 0 : 1);
