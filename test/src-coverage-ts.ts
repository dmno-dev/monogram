// src-coverage-ts.ts — TypeScript adapter for the source-coverage parser-alignment metric.
// Oracle = accept/reject (bidirectional): official accept iff sourceFile.parseDiagnostics
// is empty; Monogram accept iff our parser parses without throwing. The agnostic core
// (coverage harness, per-branch classification, ratios, disagree ledger) lives in
// ./src-coverage.ts — this file only supplies the 4 knobs (url filter, oracle, corpus,
// parser/scanner name filter) + the confusion-matrix header.
//
// ORACLE + CORPUS + MONOGRAM-INVOCATION mirror test/conformance-matrix.ts:
//   oracle:   ts.createSourceFile(...) then (sf as any).parseDiagnostics.length === 0
//   monogram: createParser(grammar).parse(code) in try/catch
//   corpus:   /tmp/ts-repo/tests/cases/conformance, .ts (not .d.ts), single-file only
//
// Run (Node 24+, bare node — NOT tsx):
//   node test/src-coverage-ts.ts            # default subset (env SUBSET, default 400)
//   node test/src-coverage-ts.ts 1000       # subset size as arg
//   node test/src-coverage-ts.ts all        # full single-file corpus

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { createParser } from '../src/gen-parser.ts';
import { run, type AgreeResult, type CorpusItem } from './src-coverage.ts';

const grammar = (await import('../typescript.ts')).default;
const { parse } = createParser(grammar);
const base = '/tmp/ts-repo/tests/cases/conformance';

// ---- corpus: walk + single-file filter (mirror conformance-matrix.ts) ----
function walk(d: string): string[] {
  let o: string[] = [];
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) o = o.concat(walk(f));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) o.push(f);
  }
  return o;
}
const isMulti = (t: string) => /^\s*\/\/\s*@filename:/im.test(t);

const all = walk(base).sort();
const arg = process.argv[2];
const SUBSET = arg === 'all' ? Infinity : Number(arg ?? process.env.SUBSET ?? 400);
// Deterministic, structurally-spread subset: stride-sample so every directory is represented.
function pick(files: { file: string; code: string }[], n: number) {
  if (!isFinite(n) || n >= files.length) return files;
  const out: { file: string; code: string }[] = [];
  const stride = files.length / n;
  for (let i = 0; i < n; i++) out.push(files[Math.floor(i * stride)]);
  return out;
}
const cases: { file: string; code: string }[] = [];
for (const f of all) {
  const code = readFileSync(f, 'utf8');
  if (!isMulti(code)) cases.push({ file: f, code });
}
const chosen = pick(cases, SUBSET);
console.log(`Corpus: ${all.length} .ts files, ${cases.length} single-file cases; running ${chosen.length}.`);

// ---- oracle + monogram verdicts ----
let officialThrew = 0;
function officialAccepts(code: string): boolean {
  // Mirror conformance-matrix.ts. One guard it lacks: on a handful of malformed inputs the
  // official parser itself throws a Debug.assert (e.g. `await using` edge cases) — a TS bug,
  // not an accept. Treat a throw as reject and tally it (partial parse still gives coverage).
  try {
    const sf = ts.createSourceFile('t.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return (((sf as any).parseDiagnostics as unknown[] | undefined)?.length ?? 0) === 0;
  } catch { officialThrew++; return false; }
}
const monogramAccepts = (code: string): boolean => { try { parse(code); return true; } catch { return false; } };

// parser/scanner-only name filter: the functions that make *syntactic* decisions. Anchored
// ^ so it matches function NAMES not substrings; excludes the *Object AST-node wrappers.
const PARSER_NAME_RE =
  /^(parse|reParse|reScan|scan(?!ner)|nextToken|tryParse|lookAhead|speculationHelper|isStartOf|isListElement|isListTerminator|canParseSemicolon|canFollow|nextTokenIs|nextTokenCan|parseList|parseDelimitedList)/;

await run({
  name: 'TypeScript',
  oracle: 'accept/reject (bidirectional)',
  urlMatch: (url) => url.includes('typescript/lib/typescript.js'),
  loadCorpus: (): CorpusItem[] => chosen.map((c) => ({ code: c.code, origin: c.file.replace(base + '/', '') })),
  warmup: () => {
    for (const w of ['const x=1;', 'class C<T>{m(){}}', 'type T=A|B;', 'function*g(){yield 1}', 'enum E{A}'])
      ts.createSourceFile('w.ts', w, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  },
  runOfficial: (code) => ({ accept: officialAccepts(code) }), // the measured ts.createSourceFile
  agree: (code, official): AgreeResult => {
    const o = (official as { accept: boolean }).accept;
    const m = monogramAccepts(code);
    return { agree: o === m, officialAccept: o, monoAccept: m };
  },
  denominators: [
    { label: 'all of typescript.js', keep: () => true },
    { label: 'parser/scanner-named functions only', keep: (p) => PARSER_NAME_RE.test(p.fnName) },
  ],
  renderHeader: (results) => {
    let TP = 0, FN = 0, FP = 0, TN = 0;
    for (const r of results) {
      const o = r.officialAccept as boolean, m = r.monoAccept as boolean;
      if (o && m) TP++; else if (o && !m) FN++; else if (!o && m) FP++; else TN++;
    }
    const total = TP + FN + FP + TN;
    console.log(`  confusion: TP=${TP} (both accept)  FN=${FN} (TS accept, we reject)  FP=${FP} (TS reject, we accept)  TN=${TN} (both reject)`);
    console.log(`  bidirectional agree: ${((100 * (TP + TN)) / total).toFixed(2)}%`);
    if (officialThrew) console.log(`  caveat: official parser threw on ${officialThrew} file(s) — counted as reject (TS Debug.assert edge cases)`);
  },
});
