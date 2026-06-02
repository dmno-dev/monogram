// ─────────────────────────────────────────────────────────────────────────────
//  vue-interp-expr.ts — `{{ }}` / directive values embed an EXPRESSION, not a whole
//  program. Vue interpolation can't contain statements: `{{ const x = 1 }}` is invalid.
//  The embed therefore uses `source.ts#expression` (a rule-rooted sub-grammar derived
//  from the TS grammar's expression rule) instead of the whole `source.ts`.
//
//  The faithful behaviour (what makes this hard):
//    - a STATEMENT keyword at the TOP of the interpolation (`const`/`let`/`for`/`return`)
//      must NOT highlight as a keyword — it isn't a valid expression there.
//    - an EXPRESSION operator (`typeof`/`as`/`new`/`in`) MUST still highlight.
//    - a statement INSIDE a nested block — `{{ (() => { const x = 1 })() }}` — MUST still
//      highlight `const`, because the arrow body re-enters the full grammar ($self). This
//      is the nuance a naive "drop const everywhere" gets wrong.
//
//  Tokenized through vscode-tmlanguage-snapshot (vuejs/language-tools' own tool) — see
//  test/vue-grammar-harness.ts — the same engine every Vue bench now uses.
//
//  Run: node test/vue-interp-expr.ts
// ─────────────────────────────────────────────────────────────────────────────
import { tokenize, type TextTok } from './vue-grammar-harness.ts';

const tok = (toks: TextTok[], text: string) => toks.find(t => t.text === text);

let pass = 0, fail = 0;
function check(label: string, cond: boolean) { if (cond) pass++; else { fail++; console.log(`✗ ${label}`); } }
const wrap = (expr: string) => `<template>\n  <p>{{ ${expr} }}</p>\n</template>`;

// ── statement keywords at the TOP of an interpolation must NOT be keywords ──
{
  const t = await tokenize('mono', wrap('const foo = 1'));
  const k = tok(t, 'const');
  check('`{{ const foo }}`: const reaches the TS embed', !!k && k.scopes.includes('source.ts'));
  check('`{{ const foo }}`: const is NOT scoped storage.type (not a valid expression)', !!k && !k.scopes.includes('storage.type'));
}
{
  const t = await tokenize('mono', wrap('return x'));
  const k = tok(t, 'return');
  check('`{{ return x }}`: return is NOT scoped keyword.control', !!k && !k.scopes.includes('keyword.control'));
}
{
  const t = await tokenize('mono', wrap('for (;;) {}'));
  const k = tok(t, 'for');
  check('`{{ for }}`: for is NOT scoped keyword.control (mixed loop group filtered)', !!k && !k.scopes.includes('keyword.control'));
}

// ── expression operators MUST still highlight ──
{
  const t = await tokenize('mono', wrap('typeof x'));
  const k = tok(t, 'typeof');
  check('`{{ typeof x }}`: typeof IS scoped keyword.operator (kept)', !!k && k.scopes.includes('keyword.operator'));
}
{
  const t = await tokenize('mono', wrap('x as Foo'));
  const k = tok(t, 'as');
  check('`{{ x as Foo }}`: as IS scoped keyword.operator (kept)', !!k && k.scopes.includes('keyword.operator'));
}
{
  const t = await tokenize('mono', wrap('new Date()'));
  const k = tok(t, 'new');
  check('`{{ new Date() }}`: new IS scoped (kept)', !!k && (k.scopes.includes('keyword.operator') || k.scopes.includes('new')));
}
// #5722 regression guard: a ternary `:` inside {{ }} must NOT be stolen by the v-bind
// directive shorthand (the injection must not re-fire inside the embedded expression), and
// highlighting must recover after the interpolation. (The injectionSelector excludes the
// embedded-expression scope — see gen-tm generateMarkupInjection.)
{
  const t = await tokenize('mono', wrap("ok ? 'a' : 'b'"));
  const colon = tok(t, ':');
  check('#5722: ternary `:` in {{ }} is NOT a v-bind directive shorthand', !!colon && !colon.scopes.includes('attribute-shorthand'));
  const closeTags = t.filter(tk => tk.text === 'template');
  check('#5722: highlighting recovers after the interpolation (</template> is a tag, not TS)', closeTags.length > 0 && closeTags.every(tk => !tk.scopes.includes('source.ts')));
}

// ── THE NUANCE: a statement inside a nested block re-enters $self → const valid there ──
{
  const t = await tokenize('mono', wrap('(() => { const x = 1 })()'));
  const k = tok(t, 'const');
  check('`{{ (()=>{const x})() }}`: NESTED const IS storage.type (re-enters $self via the block)', !!k && k.scopes.includes('storage.type'));
}

console.log(`\nvue-interp-expr: ${pass}/${pass + fail} checks pass`);
if (fail > 0) { console.log('✗ interpolation expression-scoping FAILED'); process.exit(1); }
console.log('✓ `{{ }}` embeds source.ts#expression: statements suppressed at top, operators kept, nested blocks intact');
