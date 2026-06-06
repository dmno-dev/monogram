// yaml-issue-cases.ts — REAL highlighting issues reported against the YAML grammar, as DATA (no
// side effects on import). The "official" YAML grammar is the MAINTAINED RedCMD/YAML-Syntax-
// Highlighter (microsoft/vscode#232244 switched VS Code off the dead textmate/yaml.tmbundle to it),
// so YAML's baseline is a maintained competitor — most of these it ALSO solves. Each id cites the
// underlying upstream tracker; the canonical aggregator is RedCMD/YAML-Syntax-Highlighter#1
// ("Pre-existing grammar issues"), which links the VS Code / textmate-yaml.tmbundle / atom-language-
// yaml issues. The original report against Monogram was johnsoncodehk/monogram#12, since superseded
// by RedCMD's organized #1. Shared by the README cross-language ✓ table (test/issue-table.ts).
//
// Each snippet is VALID YAML; the question is whether the grammar scopes the marked span correctly.
// Same predicate shape as html-issue-cases.ts: {id, title, src, at, nth?, want:(scope)=>boolean}.
// `want` asserts the GENUINELY-correct scope (verified by tokenizing both grammars), not "whatever
// Monogram emits". Several are both-✓ (the maintained RedCMD grammar handles them too) — that is
// honest and correct to show; #119 below is the lone Monogram-only ✓ in this set.

export interface YamlCase { id: string; title: string; src: string; at: string; nth?: number; want: (scope: string) => boolean; }

const isBlockScalar = (s: string) => s.includes('string.unquoted.block');           // | or > literal/folded body
const isEscape = (s: string) => s.includes('constant.character.escape');
const isAnchor = (s: string) => s.includes('anchor') && !!s.replace(/source\.yaml/g, '').match(/entity\.name|variable\.other/); // an anchor scope, not bare source
const isMapKeyPunct = (s: string) => s.includes('punctuation.definition.map.key');  // the `?` explicit-key indicator
const isDocMarker = (s: string) => s.includes('entity.other.document') || s.includes('keyword.control');
const isTag = (s: string) => s.includes('entity.name.tag');                          // scoped as a key NAME (entity.name.tag.yaml)
const stringResolvesTo = (lang: string) => (s: string) => s.includes('string.unquoted') && s.includes(lang); // plain scalar is lexically a string that RESOLVES to a typed constant

export const cases: YamlCase[] = [
  // ── document structure ──
  { id: 'vscode#170032', title: 'document markers `---` / `...` are document structure, not stray punctuation', src: '---\nfoo: bar\n...\n',
    at: '---', want: isDocMarker },                                                  // both scope it entity.other.document.{begin,end}.yaml — Monogram derives the marker from the grammar, the official hand-rolls it (vscode#170032: frontmatter hyphens were unscoped)

  // ── block scalars (`|` / `>`): the body is opaque string content, regardless of what it contains ──
  { id: 'atom/language-yaml#114', title: 'a `#` in a block-scalar body is content, not a comment', src: '- >\n \n  \n  # detected\n',
    at: '# detected', want: isBlockScalar },                                         // the `# detected` line is inside the folded scalar → string.unquoted.block, NOT comment.line (atom#114: a hash sign breaks highlighting)
  { id: 'tmbundle#38', title: 'a block scalar with leading/internal EMPTY lines stays one string region', src: '>\n\n folded\n line\n\n next\n   * bullet\n',
    at: 'bullet', want: isBlockScalar },                                             // `* bullet` sits after an empty line, deeper-indented — it is block-scalar content, not a sequence item or a new scalar (tmbundle#38: text after `|`/`>` colorized differently when a leading newline exists). Checkpoint is `bullet` (downstream of the empty line — the hardest span); `folded` passes identically
  { id: 'tmbundle#18', title: 'JSON-ish punctuation (`{`/`}`) and a tab indicator inside a block scalar stay content', src: 'block:\t|\n  void main() {\n  }\n',
    at: '}', want: isBlockScalar },                                                  // the `}` is literal block-scalar content, not punctuation — and the indicator follows a TAB (tmbundle#18: `{ }` inside literal style breaks highlighting; #17 is the sibling colon case)

  // ── explicit-key (`?`) constructs ──
  { id: 'RedCMD/YAML-Syntax-Highlighter#1', title: 'an anchor `&a` in explicit-key (`?`) position is still an anchor', src: '? &a a\n: &b b\n: *a\n',
    at: '&a', want: isAnchor },                                                      // `&a` after the explicit-key `?` is an anchor (entity.name.type.anchor / variable.other.anchor), not bare source — the original monogram#12 multi-item repro
  { id: 'RedCMD/YAML-Syntax-Highlighter#1', title: 'a bare `?` opening an explicit multi-line sequence key is the map-key indicator', src: '?\n- a\n- b\n:\n- c\n- d\n',
    at: '?', want: isMapKeyPunct },                                                  // the lone `?` (its value is the multi-line block sequence below) is punctuation.definition.map.key.yaml — both grammars handle the explicit complex-key form
  { id: 'RedCMD/YAML-Syntax-Highlighter#1', title: 'a block scalar used AS an explicit key is scoped as a key name', src: '? |\n  block key\n: v\n',
    at: 'block key', want: isTag },                                                  // MONOGRAM-ONLY ✓: Monogram scopes the block-scalar explicit key as a key NAME (entity.name.tag.yaml); the official leaves it string.unquoted.block (it has no entity.name.tag) → only-Monogram

  // ── quoted KEYS carry their escapes / plain scalars carry a string ancestor ──
  { id: 'atom/language-yaml#119', title: 'an escape inside a double-quoted KEY is highlighted', src: '"foo\\nbar": 23\n',
    at: '\\n', want: isEscape },                                                     // the `\n` inside the quoted key `"foo\nbar"` is constant.character.escape (atom#119: keys with escaped chars within are not highlighted correctly) — both grammars sub-scope escapes inside the key now
  { id: 'tmbundle#39', title: 'a plain scalar resolving to `null` is lexically a string that resolves to a constant', src: 'a: null\n',
    at: 'null', want: stringResolvesTo('constant.language') },                       // the FULL chain carries BOTH string.unquoted (it is lexically a plain scalar) AND constant.language (it resolves to null) — not constant.language alone (tmbundle#39: integers recognized as strings / vice versa; the string ancestor must survive)
];
