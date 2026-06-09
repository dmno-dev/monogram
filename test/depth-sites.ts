// depth-sites.ts — an IR-DERIVED enumerator of YAML value-position depth sites + a witness MATRIX.
//
// The recurring "edge cases" (monogram#23/#24, the `? a:\n  -` gap) are all ONE class: a structural
// INDICATOR literal whose correct scope depends on indentation DEPTH. The flat TextMate grammar carries
// no indent stack, so gen-tm re-introduces depth only where a value-position dispatch routes the indented
// block to the shared dispatch (the indicator scoped structurally). A gap is exactly an (indicator ×
// enclosing VALUE-POSITION) combination the emission missed — `? a:\n  -` is a `-` indicator at the
// explicit-key VALUE position (the `?`-led key's trailing `:` opens a value block).
//
// CLOSED LOOP: the enclosing value-positions are NOT a hand-written list — they are DERIVED from the same
// `valuePositions(grammar)` the emitter uses (the IR analysis that finds every introducer `-`/`?`/`:`
// opening an `Indent`-bounded value/Node alternation). Emission and verification therefore share ONE
// source: a value-position the emitter knows is exactly one this probe tests, so "0 Monogram-bug" means
// closed over ALL IR-derivable positions by construction (they cannot diverge). We realize each
// value-position as a minimal prefix, drop the DECLARED indicators (`indent.compactIndicators`) into it,
// and assert the deeper indicator is scoped PUNCTUATION (its by-construction role) — not folded into a
// string/name. A valid-YAML cell that mis-scopes is a guaranteed depth bug (the depth theorem:
// depth-needed ∧ flat-derived ⟹ the disagreement set is non-empty), checked against the official oracle.
//
// Run: node test/depth-sites.ts
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vsctm from 'vscode-textmate';
import onig from 'vscode-oniguruma';
import { parse as yamlParse } from 'yaml';
import grammar from '../yaml.ts';
import { valuePositions } from '../src/gen-tm.ts';

const { INITIAL, Registry, parseRawGrammar } = vsctm;
const { loadWASM, OnigScanner, OnigString } = onig;
const require = createRequire(import.meta.url);
await loadWASM(readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
function load(files: Record<string, string>) {
  const cache: Record<string, string> = {};
  const reg = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: (p: string[]) => new OnigScanner(p), createOnigString: (s: string) => new OnigString(s) }),
    loadGrammar: async (sn: string) => { const p = files[sn]; if (!p) return null; const c = cache[sn] ?? (cache[sn] = readFileSync(p, 'utf8')); return parseRawGrammar(c, sn + '.json'); },
  });
  return reg.loadGrammar('source.yaml');
}
const tm = (await load({ 'source.yaml': 'yaml.tmLanguage.json' }))!;
// the MAINTAINED RedCMD/VS Code official grammar (microsoft/vscode#232244) — the reference oracle:
// a cell is a MONOGRAM bug only when official scopes the indicator right and Monogram does not.
// The official RedCMD grammar is the OPTIONAL reference oracle (present in local dev / the
// readme-bench workflow). The GATE itself is self-contained: a cell FAILS when Monogram doesn't
// scope the indicator punctuation (its by-construction role) — no external corpus needed, so this
// runs in `npm run check`. When the oracle IS present it is shown for context (and confirms the
// fix matches a maintained grammar, i.e. is not a TextMate-frontier limit).
const SYN = '/tmp/redcmd-yaml/syntaxes';
const official = existsSync(join(SYN, 'yaml.tmLanguage.json')) ? (await load({
  'source.yaml': join(SYN, 'yaml.tmLanguage.json'),
  'source.yaml.1.2': join(SYN, 'yaml-1.2.tmLanguage.json'), 'source.yaml.1.1': join(SYN, 'yaml-1.1.tmLanguage.json'),
  'source.yaml.1.0': join(SYN, 'yaml-1.0.tmLanguage.json'), 'source.yaml.1.3': join(SYN, 'yaml-1.3.tmLanguage.json'),
  'source.yaml.embedded': join(SYN, 'yaml-embedded.tmLanguage.json'),
}))! : null;

interface Tok { start: number; end: number; scopes: string[] }
function tokenize(g: vsctm.IGrammar, text: string): Tok[] {
  const toks: Tok[] = []; let rs = INITIAL, off = 0;
  for (const line of text.split('\n')) { const r = g.tokenizeLine(line, rs); for (const t of r.tokens) toks.push({ start: off + t.startIndex, end: off + t.endIndex, scopes: t.scopes }); rs = r.ruleStack; off += line.length + 1; }
  return toks;
}
function innerAt(toks: Tok[], pos: number): string {
  let lo = 0, hi = toks.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (toks[mid].start <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  const s = ans >= 0 && toks[ans].end > pos ? toks[ans].scopes : [];
  return (s.length ? s[s.length - 1] : '(none)').replace(/\.yaml$/, '');
}
const valid = (s: string): boolean => { try { yamlParse(s); return true; } catch { return false; } };

// ── the DECLARED structural indicators (the literals that can lead a nested block) ──
const indicators: string[] = grammar.indent?.compactIndicators ?? [];
// ── the enclosing VALUE-POSITIONS, DERIVED from valuePositions(grammar) (NOT hand-written) ──
// Each derived introducer (`-`/`?`/`:` — every site where, after the introducer + an Indent boundary,
// a value/Node alternation is reachable) is realized as a minimal prefix that opens its indented value
// block; `\n  ` indents the child, so the deeper indicator sits at offset = prefix.length. The `:`
// (keyValueSeparator) introducer → the block-mapping value (`<key>:\n  `); a compact indicator → its
// compact-inline (`<C> `) and next-line (`<C>\n  `) value positions, PLUS the `<C> <key>:\n  `
// composition — for `?` that composition is the EXPLICIT-KEY value (the `? a:\n  -` gap shape), which
// thus FALLS OUT of the derivation rather than being special-cased. (A `valuePositions` of null — a
// non-indentation grammar — yields just the document root, so the probe degrades to a single position.)
const vps = valuePositions(grammar) ?? [];
const kvSep = grammar.indent?.keyValueSeparator ?? ':';
const KEY = 'k';   // a minimal plain-scalar key sample, for the composed key-value positions
const positions: { name: string; prefix: string }[] = [{ name: 'document root', prefix: '' }];
for (const v of vps) {
  if (v.source === 'keyValueSeparator') positions.push({ name: `map value (${v.introducer})`, prefix: `${KEY}${v.introducer}\n  ` });
  else {
    positions.push({ name: `compact ${v.introducer} (inline)`, prefix: `${v.introducer} ` });
    positions.push({ name: `compact ${v.introducer} (indented)`, prefix: `${v.introducer}\n  ` });
    positions.push({ name: `${v.introducer}-key value`, prefix: `${v.introducer} ${KEY}${kvSep}\n  ` });
  }
}

console.log(`indicators (declared indent.compactIndicators): ${indicators.map(i => JSON.stringify(i)).join(', ')}`);
console.log(`value-positions (IR-derived from valuePositions): ${vps.map(v => `${JSON.stringify(v.introducer)}[${v.source === 'keyValueSeparator' ? 'kv' : 'compact'}]`).join(', ')}`);
console.log(`legend: M=Monogram O=official(RedCMD) · want PUNCTUATION · BUG = official right, Monogram wrong\n`);
let cells = 0, monoWrong = 0, skipped = 0;
const wrong: string[] = [];
for (const ind of indicators) {
  const construct = `${ind} x`;        // the indicator leading a minimal scalar
  for (const pos of positions) {
    const input = pos.prefix + construct;
    const focus = pos.prefix.length;   // the deeper indicator char
    if (!valid(input)) { skipped++; console.log(`  – skip  [${ind} × ${pos.name}] ${JSON.stringify(input)} (invalid YAML)`); continue; }
    cells++;
    const m = innerAt(tokenize(tm, input), focus);
    const mOk = m.startsWith('punctuation');   // the indicator's by-construction role IS punctuation
    const o = official ? innerAt(tokenize(official, input), focus) : null;
    if (!mOk) { monoWrong++; wrong.push(`${ind} × ${pos.name}`); }
    const tag = mOk ? '✓ ok   ' : (o !== null && !o.startsWith('punctuation') ? '~ both ' : '✗ BUG  ');
    console.log(`  ${tag}[${ind} × ${pos.name}]  ${JSON.stringify(input)}  @${focus}«${ind}»  M→${m}${o === null ? '' : `  O→${o}`}`);
  }
}
console.log(`\n  ${cells} valid cells · ${cells - monoWrong} ok · ${monoWrong} mis-scoped${official ? '' : '  (Monogram-only — official oracle absent)'} · ${skipped} skipped`);
if (monoWrong) { console.error(`\n  DEPTH-SITE REGRESSION — value-position indicator(s) not scoped punctuation: ${wrong.join(' · ')}`); process.exit(1); }
console.log('  ✓ every IR-derived value-position scopes its indicator punctuation — closed by construction.');
