// yaml-oracle.ts — the `yaml` package (eemeli; maintained, spec-compliant) → per-token
// structural ROLE, the neutral answer key for the unified scope-gap harness. The official VS
// Code YAML grammar is the UNMAINTAINED textmate/yaml.tmbundle (vscode#203212), so the parser
// is the arbiter. Emits: mapping keys (entity.name.tag, the YAML convention), scalar VALUES by
// resolved type (string / number / boolean·null), comments, AND the structural constructs the
// coarse key/value/comment oracle used to miss (issue #12): anchors (&a), aliases (*a), document
// markers (--- / ...), and string escapes (\n) inside double-quoted scalars.
import { parseAllDocuments, isScalar, isMap, isSeq } from 'yaml';
import { R } from './scope-roles.ts';
import type { GoldToken } from './scope-gap.ts';
import type { RoleName } from './scope-roles.ts';

const valueRole = (v: unknown): RoleName =>
  typeof v === 'number' ? R.litNumber
  : (typeof v === 'boolean' || v === null) ? R.constBuiltin
  : R.litString;

// YAML double-quoted escape set (§5.7): a `\` + one escape char, or \xNN / \uNNNN / \UNNNNNNNN.
const ESCAPE = /\\(?:[0abtnvfre"/\\N_LP \t]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/g;

export function yamlOracle(text: string): GoldToken[] {
  const out: GoldToken[] = [];
  let docs: any[];
  try { docs = parseAllDocuments(text); } catch { return out; }

  const push = (node: any, role: RoleName): void => {
    const r = node?.range;
    if (r && r[1] > r[0]) out.push({ start: r[0], end: r[1], text: text.slice(r[0], r[1]), role });
  };
  // A double-quoted scalar's escape sequences each get their own escape token (a KEY or a VALUE —
  // #7 is escapes in a quoted KEY). The whole-scalar key/value token stays; escapes overlay it.
  const pushEscapes = (node: any): void => {
    const r = node?.range;
    if (!r || node.type !== 'QUOTE_DOUBLE') return;
    const seg = text.slice(r[0], r[1]);
    let m: RegExpExecArray | null;
    ESCAPE.lastIndex = 0;
    while ((m = ESCAPE.exec(seg))) out.push({ start: r[0] + m.index, end: r[0] + m.index + m[0].length, text: m[0], role: R.escape });
  };
  const walk = (node: any, isKey: boolean): void => {
    if (!node) return;
    if (isScalar(node)) { push(node, isKey ? R.tagName : valueRole(node.value)); pushEscapes(node); }
    else if (isMap(node)) for (const p of node.items) { walk(p.key, true); walk(p.value, false); }
    else if (isSeq(node)) for (const it of node.items) walk(it, false);
  };
  for (const doc of docs) walk(doc?.contents, false);

  // The scalar spans collected so far bound the regex passes below: a `&`/`*`/`#`/`---` that falls
  // INSIDE a scalar is content, not a sigil (e.g. `a & b` is one plain scalar).
  const spans = out.map((t) => [t.start, t.end] as const);
  const inSpan = (i: number): boolean => spans.some(([s, e]) => i >= s && i < e);

  // Anchors (&a) and aliases (*a): the NAME after the sigil — graded so the official `&`-split
  // (punctuation.definition.anchor + variable.other.anchor) and Monogram's single `&a` token both
  // land on the name. The sigil sits at a node boundary (line start / whitespace / flow open).
  for (const [re, role] of [
    [/(?<=^|[\s[{,])&[^\s[\]{}",]+/gm, R.anchor],
    [/(?<=^|[\s[{,])\*[^\s[\]{}",]+/gm, R.alias],
  ] as const) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (inSpan(m.index)) continue;
      out.push({ start: m.index + 1, end: m.index + m[0].length, text: m[0].slice(1), role });
    }
  }

  // Document markers (--- / ...) — line-start, followed by whitespace or EOL.
  {
    const re = /^(?:---|\.\.\.)(?=[ \t]|$)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (inSpan(m.index)) continue;
      out.push({ start: m.index, end: m.index + 3, text: m[0], role: R.docMarker });
    }
  }

  // Comments: a `#` at line start or after whitespace, to EOL — unless it falls inside a scalar
  // span (a `#` with no preceding space is plain-scalar content, e.g. `a#b`).
  const re = /#[^\n]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = m.index === 0 ? '\n' : text[m.index - 1];
    if (before !== ' ' && before !== '\t' && before !== '\n') continue;
    if (inSpan(m.index)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0], role: R.comment });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}
