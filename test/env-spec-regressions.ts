// Regression contracts for env-spec-style DSL grammars (originally PR #9, ported to the
// current token-pattern-IR API). These lock down two user-facing behaviors:
//   1. an escaped backtick string keeps backtick delimiters in TextMate (no `"` fallback)
//   2. an indentation grammar WITHOUT `indent.blockScalar` does not enforce YAML multiline
//      quoted-scalar continuation rules (so `KEY="line1\nline2"` parses)
//
// Run with: node test/env-spec-regressions.ts
import { createParser } from '../src/gen-parser.ts';
import { defineGrammar, many, opt, rule, token, seq, star, altPattern, oneOf, noneOf, anyChar, never, range, plus, followedBy, notPrecededBy } from '../src/api.ts';
import { generateTmLanguage } from '../src/gen-tm.ts';
import { generateTreeSitter } from '../src/gen-treesitter.ts';

let ok = 0;
let fail = 0;
const check = (label: string, cond: boolean) => {
  if (cond) ok++;
  else { fail++; console.log(`  ✗ ${label}`); }
};

// ---------------------------------------------------------------------------
// Regression 1: escaped backtick strings keep backtick delimiters in TextMate.
//   token pattern: `(?:\\.|[^`\\])*`   escape: \\.
// ---------------------------------------------------------------------------
{
  const BT = token(
    seq('`', star(altPattern(seq('\\', anyChar()), noneOf(oneOf('`', '\\')))), '`'),
    { scope: 'string.quoted.other', string: true, escape: seq('\\', anyChar()) },
  );
  const File = rule(() => [[BT]]);
  const grammar = defineGrammar({ name: 'backtick-string', tokens: { BT }, rules: { File }, entry: File });

  const tm = generateTmLanguage(grammar);
  const btRepo = tm.repository.bt;
  check('tm: backtick token repository entry exists', !!btRepo);
  check('tm: backtick token begin delimiter is `', btRepo?.begin === '`');
  check('tm: backtick token end delimiter is `|$', btRepo?.end === '`|$');
}

// ---------------------------------------------------------------------------
// Regression 2: indentation grammars without blockScalar must NOT enforce YAML
// multiline quoted-scalar indentation rules.
// ---------------------------------------------------------------------------
{
  const WS = token(plus(oneOf(' ', '\t')), { skip: true });
  const INDENT = token(never(), {});
  const DEDENT = token(never(), {});
  const NEWLINE = token(never(), {});
  // KEY is `[A-Z_][A-Z0-9_]*` immediately followed by `=` (a lookahead).
  const KEY = token(
    seq(oneOf(range('A', 'Z'), '_'), star(oneOf(range('A', 'Z'), range('0', '9'), '_')), followedBy('=')),
    { identifier: true },
  );
  const DQ = token(
    seq('"', star(altPattern(seq('\\', anyChar()), noneOf(oneOf('"', '\\')))), '"'),
    { string: true, escape: seq('\\', anyChar()) },
  );

  const Value = rule(() => [[DQ]]);
  const Statement = rule(() => [[KEY, '=', Value, opt(NEWLINE)]]);
  const File = rule(() => [[many(Statement)]]);

  const grammar = defineGrammar({
    name: 'indent-no-blockscalar',
    tokens: { WS, INDENT, DEDENT, NEWLINE, KEY, DQ },
    rules: { Value, Statement, File },
    indent: {
      indentToken: 'INDENT',
      dedentToken: 'DEDENT',
      newlineToken: 'NEWLINE',
      flowOpen: ['('],
      flowClose: [')'],
    },
    entry: File,
  });

  const parser = createParser(grammar);
  let threw = false;
  try {
    // Regressed when YAML block-scalar continuation checks ran for ALL indentation grammars: KEY="a\nb"
    parser.parse('KEY="line1\nline2"');
  } catch {
    threw = true;
  }
  check('parser: multiline inline quoted value is accepted without blockScalar', !threw);
}

// ---------------------------------------------------------------------------
// Regression 4 (declared below regression 3's grammar pieces): contextualScopes +
// lineComment.markup — context-dependent token scopes and declared comment markup.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Regression 3: a line-comment INTRODUCER token (`lineComment` metadata) emits
// to-end-of-line REGIONS in TextMate, not a flat 1-char rule — so comment prose
// dims to the comment scope while `richStarters`-led comments (env-spec decorator
// comments `# @dec(...)`) keep full token highlighting inside.
// ---------------------------------------------------------------------------
{
  const hspace = oneOf(' ', '\t');
  const alpha = oneOf(range('a', 'z'), range('A', 'Z'));
  const WS = token(plus(hspace), { skip: true, scope: 'meta.whitespace' });
  const DEC_NAME = token(seq('@', plus(alpha)), { scope: 'variable.annotation' });
  const HASH = token(seq(notPrecededBy(noneOf(' ', '\t', '\n', '\r')), '#'), {
    scope: 'comment.line',
    lineComment: { richStarters: [DEC_NAME] },
  });
  const KEY = token(seq(plus(alpha), followedBy('=')), { scope: 'entity.name.tag' });
  const TEXT = token(plus(noneOf(' ', '\t', '\n', '#', '=', '@')), { scope: 'string.unquoted' });
  const Part = rule(() => [DEC_NAME, TEXT]);
  const Comment = rule(() => [[HASH, many(Part)]]);
  const Item = rule(() => [[KEY, '=', opt(TEXT), opt(Comment)]]);
  const Line = rule(() => [Item, Comment]);
  const File = rule(() => [[many(Line)]]);
  const grammar = defineGrammar({
    name: 'env-spec-comments',
    tokens: { WS, HASH, DEC_NAME, KEY, TEXT },
    rules: { Part, Comment, Item, Line, File },
    entry: File,
  });

  const tm = generateTmLanguage(grammar);
  const plain = tm.repository.hash;
  const rich = tm.repository['hash-rich'];
  check('tm: plain comment entry is a to-EOL region', !!plain && plain.end === '$');
  check('tm: plain comment region carries the comment scope', plain?.name === 'comment.line.env-spec-comments');
  check('tm: plain comment region has NO inner patterns (prose dims)', Array.isArray(plain?.patterns) && plain.patterns.length === 0);
  check('tm: rich comment entry exists and is gated on the rich starter', !!rich && typeof rich.begin === 'string' && rich.begin.includes('(?=[ \\t]*'));
  check('tm: rich comment region keeps full token highlighting via $self', JSON.stringify(rich?.patterns) === JSON.stringify([{ include: '$self' }]));
  check('tm: rich entry is tried before the plain entry', (() => {
    const order = tm.patterns.map((p) => (p as { include?: string }).include);
    return order.indexOf('#hash-rich') !== -1 && order.indexOf('#hash-rich') < order.indexOf('#hash');
  })());
  check('tm: introducer captures as comment punctuation', JSON.stringify(plain?.beginCaptures?.['1']) === JSON.stringify({ name: 'punctuation.definition.comment.env-spec-comments' }));

  // parser behavior is UNaffected by the highlight-only metadata
  const parser = createParser(grammar);
  let threw = false;
  try {
    parser.parse('KEY=val # @dec note\n# plain prose');
  } catch {
    threw = true;
  }
  check('parser: lineComment metadata does not change parsing', !threw);

  // continuationBrackets: a bracket left open in a rich comment continues the construct
  // across introducer-prefixed lines via nested begin/end regions
  const HASH_ML = token(seq(notPrecededBy(noneOf(' ', '\t', '\n', '\r')), '#'), {
    scope: 'comment.line',
    lineComment: { richStarters: [DEC_NAME], continuationBrackets: [['(', ')'], ['[', ']']] },
  });
  const CommentMl = rule(() => [[HASH_ML, many(Part)]]);
  const FileMl = rule(() => [[many(CommentMl)]]);
  const mlGrammar = defineGrammar({
    name: 'env-spec-ml',
    tokens: { WS, HASH_ML, DEC_NAME, KEY, TEXT },
    rules: { Part, CommentMl, FileMl },
    entry: FileMl,
  });
  const tmMl = generateTmLanguage(mlGrammar);
  const parenKey = Object.keys(tmMl.repository).find((k) => k.startsWith('hash_ml-rich-cont-') && tmMl.repository[k].begin === '\\(');
  check('tm: continuation bracket pair emits a begin/end region', !!parenKey && tmMl.repository[parenKey!].end === '\\)');
  const parenRegion = parenKey ? tmMl.repository[parenKey] : undefined;
  const parenIncludes = (parenRegion?.patterns ?? []).map((pp) => (pp as { include?: string }).include);
  check('tm: construct interior tries marker, embedded comment, nested brackets, then $self',
    parenIncludes[0] === '#hash_ml-rich-cont-marker'
    && parenIncludes[1] === '#hash_ml-rich-cont-comment'
    && parenIncludes.includes('$self')
    && parenIncludes.filter((n) => n?.startsWith('#hash_ml-rich-cont-') && n !== '#hash_ml-rich-cont-marker' && n !== '#hash_ml-rich-cont-comment').length === 2);
  const marker = tmMl.repository['hash_ml-rich-cont-marker'];
  check('tm: continuation marker is line-anchored and scoped as comment punctuation',
    typeof marker?.match === 'string' && marker.match.startsWith('^[ \\t]*')
    && JSON.stringify(marker?.captures?.['1']?.name ?? '').includes('punctuation.definition.comment'));
  const embedded = tmMl.repository['hash_ml-rich-cont-comment'];
  check('tm: embedded comment inside a construct dims to end-of-line', embedded?.end === '$' && Array.isArray(embedded?.patterns) && embedded.patterns.length === 0);
  const richMl = tmMl.repository['hash_ml-rich'];
  const richIncludes = (richMl?.patterns ?? []).map((pp) => (pp as { include?: string }).include);
  check('tm: rich region tries construct brackets before $self', richIncludes[richIncludes.length - 1] === '$self' && richIncludes.length === 3);

  // a comment token WITHOUT the metadata still emits the flat rule (no behavior change)
  const HASH2 = token(seq(notPrecededBy(noneOf(' ', '\t', '\n', '\r')), '#'), { scope: 'comment.line' });
  const Comment2 = rule(() => [[HASH2, many(TEXT)]]);
  const File2 = rule(() => [[many(Comment2)]]);
  const flatGrammar = defineGrammar({ name: 'no-metadata', tokens: { HASH2, TEXT }, rules: { Comment2, File2 }, entry: File2 });
  const tm2 = generateTmLanguage(flatGrammar);
  check('tm: without lineComment metadata the comment token stays a flat match', typeof tm2.repository.hash2?.match === 'string' && tm2.repository.hash2?.begin === undefined);
}

// ---------------------------------------------------------------------------
// Regression 4: contextualScopes — token T carries scope S within rule R.
//   tm: overrides apply inside derived construct regions (call args + continuation
//       brackets); flat top-level rules keep the declared scope.
//   tree-sitter: exact `(rule (token) @capture)` queries, emitted last (last-wins).
// Plus lineComment.markup: declared doc-markup patterns inside plain comment bodies.
// ---------------------------------------------------------------------------
{
  const hspace = oneOf(' ', '\t');
  const alpha = oneOf(range('a', 'z'), range('A', 'Z'));
  const WS = token(plus(hspace), { skip: true, scope: 'meta.whitespace' });
  const DEC_NAME = token(seq('@', plus(alpha)), { scope: 'variable.annotation' });
  const HASH = token(seq(notPrecededBy(noneOf(' ', '\t', '\n', '\r')), '#'), {
    scope: 'comment.line',
    lineComment: {
      richStarters: [DEC_NAME],
      continuationBrackets: [['(', ')']],
      markup: [{ pattern: seq('**', star(noneOf('*', '\n')), '**'), scope: 'markup.bold' }],
    },
  });
  const KEY = token(seq(plus(alpha), followedBy('=')), { scope: 'entity.name.tag' });
  const FN_NAME = token(seq(plus(alpha), followedBy(seq(star(hspace), '('))), { scope: 'variable.function' });
  const TEXT = token(plus(noneOf(' ', '\t', '\n', '#', '=', '@', '(', ')', ',')), { scope: 'string.unquoted' });
  const ArgKV = rule(() => [[KEY, '=', TEXT]]);
  const Arg = rule(() => [ArgKV, TEXT]);
  const Args = rule(() => [['(', opt(Arg), ')']]);
  const Call = rule(() => [[FN_NAME, Args]]);
  const Part = rule(() => [DEC_NAME, Call, TEXT, KEY, '=', ',', '(', ')']);
  const Comment = rule(() => [[HASH, many(Part)]]);
  const Item = rule(() => [[KEY, '=', opt(Call), opt(Comment)]]);
  const Line = rule(() => [Item, Comment]);
  const File = rule(() => [[many(Line)]]);
  const grammar = defineGrammar({
    name: 'env-spec-ctx',
    tokens: { WS, HASH, DEC_NAME, KEY, FN_NAME, TEXT },
    rules: { ArgKV, Arg, Args, Call, Part, Comment, Item, Line, File },
    contextualScopes: [{ token: KEY, within: [ArgKV], scope: 'entity.other.attribute-name' }],
    entry: File,
  });

  const tm = generateTmLanguage(grammar);
  const callArgs = tm.repository['ctx-call-args'];
  check('tm: contextualScopes derives a call-args construct region', !!callArgs && callArgs.end === '\\)');
  const callIncludes = (callArgs?.patterns ?? []).map((pp) => (pp as { include?: string }).include);
  check('tm: construct region tries contextual overrides before $self',
    callIncludes[0]?.startsWith('#ctx-scope-') === true && callIncludes[callIncludes.length - 1] === '$self');
  const override = tm.repository[callIncludes[0]!.slice(1)];
  check('tm: the override rule carries the contextual scope',
    override?.name === 'entity.other.attribute-name.env-spec-ctx');
  const contParen = Object.keys(tm.repository).find((k) => k.startsWith('hash-rich-cont-') && tm.repository[k].begin === '\\(');
  const contIncludes = contParen ? (tm.repository[contParen].patterns ?? []).map((pp) => (pp as { include?: string }).include) : [];
  check('tm: continuation-bracket interiors include the contextual overrides',
    contIncludes.some((n) => n?.startsWith('#ctx-scope-')));
  check('tm: flat top-level token rule keeps the declared scope',
    tm.repository.key?.name === 'entity.name.tag.env-spec-ctx');
  const plain = tm.repository.hash;
  check('tm: plain comment region carries the declared markup patterns',
    Array.isArray(plain?.patterns) && plain.patterns.length === 1
    && (plain.patterns[0] as { name?: string }).name === 'markup.bold.env-spec-ctx');

  const ts = generateTreeSitter(grammar, 'env-spec-ctx');
  check('tree-sitter: contextual scope emits an exact rule-scoped query, last-wins',
    ts.highlightsScm.includes('(arg_kv (key) @attribute)')
    && ts.highlightsScm.lastIndexOf('(arg_kv (key) @attribute)') > ts.highlightsScm.lastIndexOf('Keyword, operator, and punctuation literals'));
}

console.log(
  fail === 0
    ? `\n${ok}/${ok} env-spec regression checks pass`
    : `\n${fail} FAILED (of ${ok + fail})`,
);
process.exit(fail === 0 ? 0 : 1);
