// ─────────────────────────────────────────────────────────────────────────────
//  vue-highlight.ts — gates the DERIVED Vue SFC TextMate grammar (vue.tmLanguage.json,
//  increment 1: block skeleton + block-level embeds). A .vue file is highlighted by
//  COMPOSING Monogram's own grammars: <template> embeds Monogram's HTML, <script> its
//  proven JS/TS, <style> CSS (delegated). Tokenizes an SFC with those registered and
//  asserts each block delegates to the right sub-language.
//
//  Increment 2 (Vue directives v-if/:bind/@event/#slot + {{ }} interpolation) is not
//  covered here yet — :class / {{ }} inside <template> are still plain HTML.
//
//  Tokenized through vscode-tmlanguage-snapshot (vuejs/language-tools' own tool) — see
//  test/vue-grammar-harness.ts — the same engine every Vue bench now uses.
//
//  Run: node test/vue-highlight.ts
// ─────────────────────────────────────────────────────────────────────────────
import { tokenize } from './vue-grammar-harness.ts';

const sfc = [
  '<template>',
  '  <div class="box"><span>hi</span></div>',
  '</template>',
  '',
  '<script>',
  'const n = 1 < 2;',
  '</script>',
  '',
  '<style>',
  '.box { color: red }',
  '</style>',
].join('\n');
const toks = await tokenize('mono', sfc);

let pass = 0, fail = 0;
const find = (text: string, pred: (s: string) => boolean) => toks.find(t => t.text === text && pred(t.scopes));
function check(label: string, cond: boolean, detail = '') {
  if (cond) pass++; else { fail++; console.log(`✗ ${label}${detail ? '\n    ' + detail : ''}`); }
}

// ── blocks recognized as Vue SFC blocks ──
check('<template> block → meta.template.vue', !!find('template', s => s.includes('meta.template.vue') && s.includes('entity.name.tag.vue')));
check('<script> block → meta.script.vue', !!find('script', s => s.includes('meta.script.vue') && s.includes('entity.name.tag.vue')));
check('<style> block → meta.style.vue', !!find('style', s => s.includes('meta.style.vue') && s.includes('entity.name.tag.vue')));

// ── <template> body is Monogram's HTML, embedded as text.html.derivative (the embedded-HTML-
//    fragment scope; Monogram's own HTML rules run under it and emit entity.name.tag.html) ──
check('<template> body embeds HTML (div → entity.name.tag.html)', !!find('div', s => s.includes('text.html.derivative') && s.includes('entity.name.tag.html')));
check('<template> body: attribute → HTML attribute-name', !!find('class', s => s.includes('text.html.derivative') && s.includes('entity.other.attribute-name')));

// ── <script> body is Monogram's JS (the headline: < is a JS operator, not a tag) ──
check('<script> body embeds JS (const → storage.type.js)', !!find('const', s => s.includes('source.js') && s.includes('storage.type')));
check('<script> body: `<` is a JS operator, not a tag', !!find('<', s => s.includes('source.js') && s.includes('keyword.operator')));

// ── <style> body is CSS ──
check('<style> body embeds CSS', toks.some(t => t.text.includes('color') && t.scopes.includes('source.css')));

// ── lang= selection: <script setup lang="ts"> embeds Monogram's TS (the headline) ──
{
  const ts = await tokenize('mono', '<script setup lang="ts">const x: number = 1;</script>');
  const f = (text: string, pred: (s: string) => boolean) => ts.find(t => t.text === text && pred(t.scopes));
  check('<script lang="ts"> body → Monogram TS (const → storage.type.ts)', !!f('const', s => s.includes('source.ts') && s.includes('storage.type')));
  check('<script lang="ts"> TS type annotation `:` (TS-only syntax)', !!f(':', s => s.includes('source.ts') && s.includes('type.annotation')));
}

console.log(`\nvue-highlight: ${pass}/${pass + fail} checks pass`);
if (fail > 0) { console.log('✗ Vue SFC highlighter FAILED'); process.exit(1); }
console.log('✓ Vue SFC: <template>→Monogram HTML, <script>→Monogram JS, <style>→CSS, all composed from one engine');
