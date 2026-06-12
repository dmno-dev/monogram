// tree-sitter-highlight.ts — tree-sitter highlight CORRECTNESS for token-soup indentation
// languages, specified as gen-treesitter behavior over a TOY Pug-like grammar (token names /
// selector characters deliberately unlike any real language — the behavior is grammar DATA).
//
// THE PROBLEM. A token-soup head `tag.class(attrs)` reuses the SAME token shapes in two roles:
// a leading word is a TAG, but the identical word later on the line is plain TEXT; a `.cls`
// glued to the head is a class, but the structure also lets a bare word run as text. tree-sitter
// gets this wrong in two ways:
//   (a) LEXING — a tag-name token and a free text run can both match the leading word; tree-sitter
//       prefers the LONGER match, so the whole `div.card` is swallowed as text and never tagged.
//   (b) HIGHLIGHTING — a single `(tag_name) @tag` query paints EVERY tag-shaped word, including the
//       ones sitting inside an inline-text run, so interior prose lights up as tags.
// Plus a generation BUG: a flow-collection delimiter (`(`/`)`) is emitted by the external scanner
// as a HIDDEN node (`_flow_lparen`), which a highlight query may reference as neither `"("` nor
// `(_flow_lparen)` — emitting it made the whole highlights.scm fail to compile.
//
// THE CONTRACT.
//   • `tsPrec: N` on a token → `token(prec(N, …))`, so a tag name WINS the lexer over a longer text
//     run (tree-sitter prefers precedence, then length). Inert for every other generator.
//   • `tsTextRules: ['TextSoup']` → for each declared text rule, every structural token reachable in
//     it also gets a context override `(text_soup (tag_name) @none)`, placed AFTER the generic
//     capture so it wins inside that rule only — the word is plain text there, a tag everywhere else.
//   • A flow delimiter is OMITTED from the punctuation-literal query (it can't be referenced), so the
//     query compiles; the delimiter simply highlights as default.
//
// These tests assert the EMITTED tree-sitter target (grammar.js + highlights.scm), not the
// implementation — a reimplementation must satisfy them. The `baseline` (no tsPrec / no tsTextRules)
// cases pin down exactly what each opt-in changes. NMBL's real generated grammar is build-verified
// separately (`tree-sitter generate` + `tree-sitter query highlights.scm` both succeed).
import { token, rule, defineGrammar, alt, many, opt, seq, noneOf, range, plus, star, never } from '../src/api.ts';
import type { IndentConfig } from '../src/types.ts';
import { generateTreeSitter } from '../src/gen-treesitter.ts';

let ok = 0, fail = 0;
const check = (label: string, cond: boolean) => { cond ? ok++ : (fail++, console.log('  ✗', label)); };

// ── Toy grammar: `Tag(.cls)*(att…)? text…` where a tag-shaped word may also run as text ──
const lower = range('a', 'z'), upper = range('A', 'Z');
const Indent = token(never(), {}), Dedent = token(never(), {}), Newline = token(never(), {});
const Tag  = (pr: boolean) => token(plus(lower), { blockOnly: true, identifier: true, scope: 'entity.name.tag', ...(pr ? { tsPrec: 1 } : {}) });
const Comp = (pr: boolean) => token(seq(upper, star(lower)), { blockOnly: true, identifier: true, scope: 'support.class.component', ...(pr ? { tsPrec: 1 } : {}) });
const Cls  = token(seq('.', plus(lower)), { blockOnly: true, scope: 'entity.other.attribute-name.class' });
const Att  = token(plus(lower), { scope: 'entity.other.attribute-name' });
const Txt  = token(plus(noneOf(' ', '\t', '\n', '(', ')')), { blockOnly: true, scope: 'text' });
const indent: IndentConfig = { indentToken: 'Indent', dedentToken: 'Dedent', newlineToken: 'Newline', flowOpen: ['('], flowClose: [')'] };

function mk(opts: { prec: boolean; textRule: boolean }) {
  const T = Tag(opts.prec), C = Comp(opts.prec);
  const Attrs = rule(() => [['(', many(Att), ')']]);
  // A tag-shaped word (T) appears INSIDE the text run — the over-paint hazard.
  const TextSoup = rule(() => [[many(alt(T, Cls, Txt, '(', ')'))]]);
  const Head = rule(() => [[alt(T, C), many(Cls)]]);
  const Elem = rule(() => [[Head, opt(Attrs), opt(TextSoup)]]);
  const Doc  = rule(() => [[opt(Elem)]]);
  return defineGrammar({
    name: 'toy',
    tokens: { Indent, Dedent, Newline, TagName: T, ComponentName: C, Cls, Att, Txt },
    rules: { Attrs, TextSoup, Head, Elem, Doc },
    entry: Doc, indent,
    ...(opts.textRule ? { tsTextRules: ['TextSoup'] } : {}),
  });
}
const gen = (o: { prec: boolean; textRule: boolean }) => generateTreeSitter(mk(o) as any, 'toy') as { grammarJs: string; highlightsScm: string };

// ── 1. tsPrec: a tag name token wins the lexer via token(prec(N, …)) ──
const withPrec = gen({ prec: true, textRule: true });
const noPrec   = gen({ prec: false, textRule: true });
check('tsPrec: the tag-name token is emitted as token(prec(1, …)) so it beats a longer text run',
  /token\(prec\(1,\s*\/\[a-z\]\+\//.test(withPrec.grammarJs));
check('tsPrec baseline: without tsPrec the tag-name token is a plain token() (loses to longer match)',
  /token\(\/\[a-z\]\+\//.test(noPrec.grammarJs) && !/token\(prec\(1,\s*\/\[a-z\]\+\//.test(noPrec.grammarJs));

// ── 2. tsTextRules: structural tokens inside the text rule are overridden to plain text ──
const withText = withPrec.highlightsScm;
const noText   = gen({ prec: true, textRule: false }).highlightsScm;
check('tsTextRules: the generic tag capture (tag_name) @tag is still emitted (tag everywhere else)',
  /\(tag_name\)\s*@tag/.test(withText));
check('tsTextRules: a context override (text_soup (tag_name) @none) makes the word plain text in the run',
  /\(text_soup\s*\(tag_name\)\s*@none\)/.test(withText));
check('tsTextRules: the override is placed AFTER the generic capture so it wins (later pattern wins)',
  withText.indexOf('(tag_name) @tag') < withText.indexOf('(text_soup (tag_name) @none)'));
check('tsTextRules baseline: without tsTextRules no @none context override is emitted (interior text over-paints)',
  /\(tag_name\)\s*@tag/.test(noText) && !/\(text_soup\s*\(tag_name\)\s*@none\)/.test(noText));

// ── 3. flow-delimiter exclusion: hidden flow nodes are never referenced (the query must compile) ──
// `(`/`)` are flow delimiters → hidden `_flow_lparen` external nodes. Referencing them (as `(_flow_lparen)`
// OR as the anonymous `"("`) makes `tree-sitter query` reject the whole file. They must be omitted.
check('flow exclusion: the highlights query never references a hidden flow node by name',
  !/_flow_lparen|_flow_rparen/.test(withText));
const punctLines = withText.split('\n').filter(l => /@punctuation\.delimiter/.test(l) || /^\s*"[(){}]"/.test(l));
check('flow exclusion: a flow `(` / `)` delimiter is not emitted as a punctuation literal',
  !punctLines.some(l => /"\("|"\)"/.test(l)));

console.log(`  tree-sitter-highlight: ${ok} checks pass${fail ? `, ${fail} FAIL` : ''}`);
process.exit(fail ? 1 : 0);
