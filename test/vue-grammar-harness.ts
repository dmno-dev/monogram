// ─────────────────────────────────────────────────────────────────────────────
//  vue-grammar-harness.ts — builds the Monogram and official Vue grammars through
//  vuejs/language-tools' OWN test tool, `vscode-tmlanguage-snapshot` (the engine behind
//  their extensions/vscode/tests/grammar.spec.ts). Instead of hand-wiring a vscode-textmate
//  Registry + getInjections, we hand the tool a package.json-shaped descriptor and let it
//  resolve grammars + injections from `contributes.grammars` / `injectTo` exactly the way
//  VS Code does. This makes the head-to-head FAITHFUL to how the official grammar is tested.
//
//  Fairness (unchanged from the old harness): BOTH grammars embed Monogram's OWN
//  source.ts / source.js / text.html.basic, so the script/template body tokenizes
//  identically and only the VUE LAYER (block regions, embed boundaries, directives,
//  interpolation) differs. CSS dialects we don't grade get a one-scope stub.
//
//  The tool only renders a snapshot STRING; we parse that back into per-line tokens so the
//  benches keep their precise offset→scope lookups. Shared by vue-issues.ts and vue-bench.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { createGrammarSnapshot } from 'vscode-tmlanguage-snapshot';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const FIX = join(REPO, 'test/fixtures/vue-official');
export const officialAvailable = existsSync(join(FIX, 'vue.tmLanguage.json'));

// One scratch dir for the .vue fixture we re-write per snippet + the CSS-dialect stubs.
const work = mkdtempSync(join(tmpdir(), 'vue-harness-'));
const stub = (sn: string) => {
  const p = join(work, `${sn}.json`);
  writeFileSync(p, JSON.stringify({ scopeName: sn, patterns: [{ match: '[^\\n]+', name: sn }] }));
  return p;
};
// Embedded grammars handed to BOTH grammars (identical → isolates the Vue layer). The CSS
// dialects are stubbed (we don't pit them head-to-head; the stub keeps familyOf() === 'css').
// text.html.derivative is Monogram's emitted thin alias of text.html.basic — the embedded-HTML
// scope the template embeds and interpolation injects onto (both grammars get the same one, so
// the official grammar, which targets text.html.derivative too, is tested faithfully).
// source.tsx / source.js.jsx are Monogram's typescriptreact/javascriptreact grammars: BOTH Vue
// grammars embed them for `<script lang="tsx">` / `lang="jsx">` (the official fixture references
// source.tsx 8× and source.js.jsx 4×), so registering them is the faithful set — without them
// vscode-textmate DROPS the `lang="tsx"`/`"jsx"` regions (their `include` is unresolved) and the
// body falls through to the default source.js, masking the declared-scope embed (vuejs#4291).
const embedded = [
  join(REPO, 'html.tmLanguage.json'),             // text.html.basic
  join(REPO, 'html-derivative.tmLanguage.json'),  // text.html.derivative
  join(REPO, 'typescript.tmLanguage.json'),       // source.ts
  join(REPO, 'javascript.tmLanguage.json'),       // source.js
  join(REPO, 'typescriptreact.tmLanguage.json'),  // source.tsx       (<script lang="tsx">)
  join(REPO, 'javascriptreact.tmLanguage.json'),  // source.js.jsx    (<script lang="jsx">)
  ...['source.css', 'source.css.scss', 'source.css.less', 'source.sass', 'source.stylus', 'source.postcss'].map(stub),
];
// The official injectTo set (Volar's package.json) — the host grammars each injection loads into.
const INJECT_TO = ['text.html.vue', 'text.html.markdown', 'text.html.derivative', 'text.pug'];

// Write a package.json descriptor (its dir is rootDir; grammar paths must be relative to it).
function descriptor(tag: string, grammars: { scopeName: string; abs: string; language?: string; injectTo?: string[] }[]) {
  const dir = mkdtempSync(join(tmpdir(), `vue-${tag}-`));
  const pkg = {
    contributes: {
      languages: [{ id: 'vue', extensions: ['.vue'] }],
      grammars: grammars.map(g => ({ language: g.language, scopeName: g.scopeName, path: relative(dir, g.abs), injectTo: g.injectTo })),
    },
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return join(dir, 'package.json');
}

// Both grammars now use the SAME two-thin-stub topology (vue.directives / vue.interpolations
// injected into the official host set) — Monogram is a drop-in for the official files.
const monoPkg = descriptor('mono', [
  { language: 'vue', scopeName: 'text.html.vue', abs: join(REPO, 'vue.tmLanguage.json') },
  { scopeName: 'vue.directives', abs: join(REPO, 'vue.directives.tmLanguage.json'), injectTo: INJECT_TO },
  { scopeName: 'vue.interpolations', abs: join(REPO, 'vue.interpolations.tmLanguage.json'), injectTo: INJECT_TO },
]);
const offPkg = officialAvailable ? descriptor('off', [
  { language: 'vue', scopeName: 'text.html.vue', abs: join(FIX, 'vue.tmLanguage.json') },
  { scopeName: 'vue.directives', abs: join(FIX, 'vue-directives.json'), injectTo: INJECT_TO },
  { scopeName: 'vue.interpolations', abs: join(FIX, 'vue-interpolations.json'), injectTo: INJECT_TO },
]) : null;

const snapMono = await createGrammarSnapshot(monoPkg, { extraGrammarPaths: embedded });
const snapOff = offPkg ? await createGrammarSnapshot(offPkg, { extraGrammarPaths: embedded }) : null;

export interface Tok { startIndex: number; endIndex: number; scopes: string[] }

// Parse the tool's rendered snapshot (>source line, then `#  ^^^ scope scope…` token lines)
// back into per-line token arrays.
function parseSnapshot(rendered: string): Tok[][] {
  const lines: Tok[][] = [];
  let cur: Tok[] | null = null;
  for (const row of rendered.split('\n')) {
    if (row[0] === '>') { cur = []; lines.push(cur); }
    else if (row[0] === '#' && cur) {
      const m = /^#( *)(\^+) (.*)$/.exec(row);
      if (m) cur.push({ startIndex: m[1].length, endIndex: m[1].length + m[2].length, scopes: m[3].split(' ') });
    }
  }
  return lines;
}

const fixture = join(work, 'case.vue');
const memo = new Map<string, Tok[][]>();   // (which|src) → tokens; benches re-tokenize the same source
async function tokenizeLines(which: 'mono' | 'off', src: string): Promise<Tok[][]> {
  const snap = which === 'mono' ? snapMono : snapOff;
  if (!snap) throw new Error('official Vue grammar not available');
  const key = `${which}\0${src}`;
  let toks = memo.get(key);
  if (!toks) { writeFileSync(fixture, src); toks = parseSnapshot(await snap(fixture)); memo.set(key, toks); }
  return toks;
}

export interface TextTok { text: string; scopes: string }
// Flat list of non-whitespace tokens with space-joined scopes — mirrors the old per-test
// `tokenize(src)` (find a token by exact text, inspect its scopes).
export async function tokenize(which: 'mono' | 'off', src: string): Promise<TextTok[]> {
  const lineToks = await tokenizeLines(which, src);
  const lines = src.split('\n'); const out: TextTok[] = [];
  for (let li = 0; li < lineToks.length; li++) {
    const line = lines[li] ?? '';
    for (const t of lineToks[li]) { const text = line.slice(t.startIndex, t.endIndex); if (text.trim()) out.push({ text, scopes: t.scopes.join(' ') }); }
  }
  return out;
}

// offset → scopes[] lookup over a tokenized source (mirrors the old benches' scopeLookup).
export async function scopeLookup(which: 'mono' | 'off', src: string): Promise<(offset: number) => string[]> {
  const lineToks = await tokenizeLines(which, src);
  const lines = src.split('\n'); const lineStart: number[] = []; let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  return (offset: number) => {
    let li = 0; while (li + 1 < lineStart.length && lineStart[li + 1] <= offset) li++;
    const col = offset - lineStart[li];
    for (const t of lineToks[li] ?? []) if (col >= t.startIndex && col < t.endIndex) return t.scopes;
    return [];
  };
}
