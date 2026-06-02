// ─────────────────────────────────────────────────────────────────────────────
//  vue-directives.ts — gates Vue increment 2: the DERIVED injection grammar
//  (vue.directives.json / vue.interpolations.json) adds directives (v-for / v-if / :bind / @event /
//  #slot) and {{ }} interpolation ONTO the HTML scopes inside a <template>. Because the
//  template reuses HTML wholesale, this is injection — exactly the official architecture.
//  Directive values and interpolation embed Monogram's OWN TS grammar (source.ts), so
//  Vue template expressions get Monogram's (more-correct) TS highlighting.
//
//  Like a real editor's injectTo contribution, the injection grammar is loaded into the
//  registry and registered (getInjections) so it applies to the HTML scopes.
//
//  Tokenized through vscode-tmlanguage-snapshot (vuejs/language-tools' own tool) — see
//  test/vue-grammar-harness.ts — the same engine every Vue bench now uses.
//
//  Run: node test/vue-directives.ts
// ─────────────────────────────────────────────────────────────────────────────
import { tokenize } from './vue-grammar-harness.ts';

const sfc = [
  '<template>',
  '  <ul id="main">',
  '    <li v-for="item in items" :key="item.id" @click="go(item)">',
  '      {{ item.name + 1 }}',
  '    </li>',
  '    <p v-if="show">x</p>',
  '  </ul>',
  '</template>',
].join('\n');
const toks = await tokenize('mono', sfc);

let pass = 0, fail = 0;
const find = (text: string, pred: (s: string) => boolean) => toks.find(t => t.text === text && pred(t.scopes));
function check(label: string, cond: boolean) {
  if (cond) pass++; else { fail++; console.log(`✗ ${label}`); }
}

// ── directives (injected onto the embedded HTML, inside <template>) ──
check('v-for → keyword.control.loop.vue', !!find('v-for', s => s.includes('keyword.control.loop.vue')));
check('v-if → keyword.control.conditional.vue', !!find('v-if', s => s.includes('keyword.control.conditional.vue')));
check(': (v-bind shorthand) → punctuation.attribute-shorthand.bind', !!find(':', s => s.includes('punctuation.attribute-shorthand.bind')));
check('@ (v-on shorthand) → punctuation.attribute-shorthand.event', !!find('@', s => s.includes('punctuation.attribute-shorthand.event')));

// ── directive VALUES embed Monogram's TS ──
check('v-for value "item in items" → TS (item is a TS variable)', !!find('item', s => s.includes('source.ts') && s.includes('variable')));
check('v-for value: `in` → TS operator', !!find('in', s => s.includes('source.ts') && s.includes('keyword')));
check('@click value "go(item)" → TS (go embedded)', !!find('go', s => s.includes('source.ts')));

// ── {{ }} interpolation → delimiters + Monogram's TS expression ──
check('{{ → interpolation.begin', !!find('{{', s => s.includes('punctuation.definition.interpolation.begin')));
check('}} → interpolation.end', !!find('}}', s => s.includes('punctuation.definition.interpolation.end')));
check('interpolation body → Monogram TS (1 → numeric)', !!find('1', s => s.includes('source.ts') && s.includes('constant.numeric')));

// ── a plain HTML attribute (id="main") is NOT mis-embedded as TS — the injection's value
//    embed lives inside a directive region, so it only fires for directives ──
check('plain attr value "main" stays HTML, not TS', !!find('main', s => s.includes('string') && !s.includes('source.ts')));

console.log(`\nvue-directives: ${pass}/${pass + fail} checks pass`);
if (fail > 0) { console.log('✗ Vue directives/interpolation FAILED'); process.exit(1); }
console.log('✓ Vue directives + {{ }} inject onto the template HTML; values + interpolation are Monogram TS');
