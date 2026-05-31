// ─────────────────────────────────────────────────────────────────────────────
//  vue-issues.ts — Monogram's DERIVED Vue grammar vs the hand-written official, on REAL
//  highlighting bugs reported against vuejs/language-tools' vue.tmLanguage.json (the same
//  approach as html-bench, which tests documented textmate/html.tmbundle issues — not a
//  self-curated corpus). The cases live in vue-issue-cases.ts (shared with the README's
//  cross-language ✓ table, test/issue-table.ts).
//
//  Most are CLOSED — the hand-written grammar accumulated + hand-fixed them over many
//  releases. The thesis question: does the DERIVED grammar exhibit them, or is it correct
//  BY CONSTRUCTION? The headline family is TS operators inside template expressions
//  (instanceof / typeof / ?? / ?. / => / <): Monogram embeds its OWN proven TS
//  (source.ts#expression) and gets them free; the official patched each one over time.
//
//  Run: node test/vue-issues.ts   (needs test/fixtures/vue-official — see vue-bench.ts header)
// ─────────────────────────────────────────────────────────────────────────────
import vsctm from 'vscode-textmate';
import onig from 'vscode-oniguruma';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cases } from './vue-issue-cases.ts';

const { INITIAL, Registry, parseRawGrammar } = vsctm;
const require = createRequire(import.meta.url);
const FIX = 'test/fixtures/vue-official';
if (!existsSync(`${FIX}/vue.tmLanguage.json`)) { console.log('⊘ Skipped: official Vue grammars not found (see test/vue-bench.ts header to fetch).'); process.exit(0); }
const wasmBin = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
await onig.loadWASM(wasmBin.buffer.slice(wasmBin.byteOffset, wasmBin.byteOffset + wasmBin.byteLength));
const onigLib = Promise.resolve({ createOnigScanner: (p: string[]) => new onig.OnigScanner(p), createOnigString: (s: string) => new onig.OnigString(s) });
const read = (p: string) => readFileSync(p, 'utf-8');
const stub = (sn: string) => parseRawGrammar(JSON.stringify({ scopeName: sn, patterns: [{ match: '[^\\n]+', name: sn }] }), `${sn}.json`);

function mkRegistry(official: boolean) {
  return new Registry({
    onigLib,
    loadGrammar: async (sn) => {
      if (sn === 'text.html.vue') return parseRawGrammar(read(official ? `${FIX}/vue.tmLanguage.json` : 'vue.tmLanguage.json'), 'vue.json');
      if (sn === 'text.html.basic') return parseRawGrammar(read('html.tmLanguage.json'), 'html.json');
      if (sn === 'source.ts') return parseRawGrammar(read('typescript.tmLanguage.json'), 'ts.json');
      if (sn === 'source.js') return parseRawGrammar(read('javascript.tmLanguage.json'), 'js.json');
      if (sn === 'vue.injection') return parseRawGrammar(read('vue.injection.tmLanguage.json'), 'inj.json');
      if (sn === 'vue.directives') return parseRawGrammar(read(`${FIX}/vue-directives.json`), 'dir.json');
      if (sn === 'vue.interpolations') return parseRawGrammar(read(`${FIX}/vue-interpolations.json`), 'int.json');
      if (sn.startsWith('source.')) return stub(sn);
      return null;  // text.* → no-op include (text.html.basic does the parsing)
    },
    getInjections: (sn) => official
      ? (sn === 'text.html.vue' ? ['vue.directives', 'vue.interpolations'] : undefined)
      : ((sn === 'text.html.basic' || sn === 'text.html.vue') ? ['vue.injection'] : undefined),
  });
}
async function loadVue(official: boolean) {
  const reg = mkRegistry(official);
  if (official) { await reg.loadGrammar('vue.directives'); await reg.loadGrammar('vue.interpolations'); }
  else { await reg.loadGrammar('vue.injection'); }
  return (await reg.loadGrammar('text.html.vue'))!;
}
const monoVue = await loadVue(false), offVue = await loadVue(true);

function scopeLookup(grammar: any, src: string): (offset: number) => string {
  const lines = src.split('\n'); const lineStart: number[] = []; let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const lineToks: any[][] = []; let stack: any = INITIAL;
  for (const l of lines) { const r = grammar.tokenizeLine(l, stack); lineToks.push(r.tokens); stack = r.ruleStack; }
  return (offset: number) => {
    let li = 0; while (li + 1 < lineStart.length && lineStart[li + 1] <= offset) li++;
    const col = offset - lineStart[li];
    for (const t of lineToks[li] ?? []) if (col >= t.startIndex && col < t.endIndex) return t.scopes.join(' ');
    return '';
  };
}
// at(text[, nth]) → scope string at the middle of the nth occurrence of `text`.
function makeAt(look: (o: number) => string, src: string) {
  return (text: string, nth = 0) => {
    let i = -1; for (let k = 0; k <= nth; k++) i = src.indexOf(text, i + 1);
    return i < 0 ? '__NOT_FOUND__' : look(i + Math.floor(text.length / 2));
  };
}

// Expected outcomes — a SNAPSHOT of the honest current state, so this gate catches a
// REGRESSION (a ✓ that flips to ✗) or an unexpected change. The one remaining gap:
//   #6007 — shared #5012 intra-line `as` ceiling (both fail; pure-TM limit, semantic-only).
//   (#5722 and #3999 were Monogram gaps — both FIXED; see gen-tm generateMarkupInjection /
//    emitRawMultiline.)
const expect: Record<string, { mono: boolean; off: boolean }> = {
  '#3400': { mono: true, off: true }, '#5370': { mono: true, off: true }, '#5118': { mono: true, off: true },
  '#1675': { mono: true, off: true }, '#6039/#4741': { mono: true, off: true }, '#5722': { mono: true, off: true },
  '#6007/#2096/#520': { mono: false, off: false }, '#5538/#2060': { mono: true, off: true },
  '#3999': { mono: true, off: true }, '#4769': { mono: true, off: true }, '#5701': { mono: true, off: true },
  '#6070': { mono: true, off: true },
};

let mPass = 0, oPass = 0; const rows: string[] = []; const deviations: string[] = [];
for (const c of cases) {
  const mAt = makeAt(scopeLookup(monoVue, c.src), c.src), oAt = makeAt(scopeLookup(offVue, c.src), c.src);
  const mOk = c.checks.every(ch => ch.want(mAt(ch.at, ch.nth)));
  const oOk = c.checks.every(ch => ch.want(oAt(ch.at, ch.nth)));
  if (mOk) mPass++; if (oOk) oPass++;
  const gap = !mOk && oOk ? '  ← Monogram gap' : (!mOk && !oOk ? '  ← shared ceiling' : '');
  rows.push(`  ${c.id.padEnd(16)} ${(mOk ? '✓' : '✗').padEnd(9)} ${(oOk ? '✓' : '✗').padEnd(9)} ${c.title}${gap}`);
  const e = expect[c.id];
  if (e && (e.mono !== mOk || e.off !== oOk)) deviations.push(`  ${c.id}: expected Monogram ${e.mono}/official ${e.off}, got ${mOk}/${oOk}`);
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('  REAL reported highlighting issues vs vuejs/language-tools vue.tmLanguage.json');
console.log('  (both grammars CURRENT; both embed Monogram\'s source.ts — isolates the Vue layer)');
console.log('══════════════════════════════════════════════════════════════════════');
console.log(`  ${'issue'.padEnd(16)} ${'Monogram'.padEnd(9)} ${'official'.padEnd(9)} title`);
for (const r of rows) console.log(r);
console.log('  ' + '─'.repeat(60));
console.log(`  ${'PASS'.padEnd(16)} ${(`${mPass}/${cases.length}`).padEnd(9)} ${oPass}/${cases.length}`);
console.log(`\n  Honest reading: these are REAL bugs the hand-written grammar accumulated + hand-fixed`);
console.log(`  over many releases. Monogram WINS the operator family (instanceof / typeof / ?? / ?. /`);
console.log(`  => / <) BY CONSTRUCTION — it embeds its own proven TS, never a per-operator patch.`);
console.log(`  Remaining gap: #6007 (shared #5012 \`as\` intra-line ceiling — both fail, semantic-only).`);
// Gate: reality must match the recorded snapshot — catches a regression or an unexpected change.
if (deviations.length) { console.log('\n✗ Result changed from the recorded snapshot (update expect{} if intended):'); for (const d of deviations) console.log(d); process.exit(1); }
console.log(`\n✓ Matches the recorded snapshot: Monogram ${mPass}/${cases.length}, official ${oPass}/${cases.length} on real reported issues.`);
