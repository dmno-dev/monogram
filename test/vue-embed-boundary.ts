// ─────────────────────────────────────────────────────────────────────────────
//  vue-embed-boundary.ts — the embed BOUNDARY tests (the hard cases the user flagged).
//  An embedded grammar (Monogram's TS) must not consume past the host's structural
//  boundary, even when its own region is open mid-construct.
//
//    #1666 — `type Foo = 123` (no `;`) then `</script>`. The TS `type` body region is
//            open, but `</script>` is HTML's raw-text terminator and MUST end the embed.
//            GENERAL solution = a `begin/while` script region (re-checks per line, drops
//            the region + pops the open TS region at the `</script>` line). GATED here.
//
//    #5012 — `:value="msg as string"`. The closing `"` is an INTRA-LINE boundary a `while`
//            (line-granularity) can't enforce, and a begin/end embed lets the `as`-cast eat
//            the quote as a string-literal-type. SOLVED in pure TM: the value is CAPTURE-
//            EMBEDDED into a `([^"]*)` span, so the embedded grammar is clipped at the quote
//            (a capture's text range can't be crossed). GATED below.
//
//  Tokenized through vscode-tmlanguage-snapshot (vuejs/language-tools' own tool) — see
//  test/vue-grammar-harness.ts — the same engine every Vue bench now uses.
//
//  Run: node test/vue-embed-boundary.ts
// ─────────────────────────────────────────────────────────────────────────────
import { tokenize, type TextTok } from './vue-grammar-harness.ts';

const find = (toks: TextTok[], text: string, pred: (s: string) => boolean) => toks.find(t => t.text === text && pred(t.scopes));

let pass = 0, fail = 0;
function check(label: string, cond: boolean) { if (cond) pass++; else { fail++; console.log(`✗ ${label}`); } }

// ── #1666 (GATED): the embed must END at </script> even with an open trailing type ──
{
  const t = await tokenize('mono', '<script lang="ts">\ntype Foo = 123\n</script>\n<template><b /></template>');
  check('#1666: the trailing `type Foo = 123` highlights as TS', !!find(t, 'type', s => s.includes('source.ts') && s.includes('storage.type')));
  // the key fix: </script> ends the embed → the following <template> block is NOT swallowed into source.ts
  check('#1666: </script> ends the embed — the following <template> is NOT TS', !t.some(tk => tk.text === 'template' && tk.scopes.includes('source.ts')));
  check('#1666: the <b> in the template is HTML, not TS', !t.some(tk => tk.text === 'b' && tk.scopes.includes('source.ts')));
}

// ── #5012 (GATED, FIXED): `:value="msg as string"` — the `as`-cast must NOT run its type
//    context past the closing `"` and swallow the rest of the tag. The directive value is
//    CAPTURE-EMBEDDED (a `([^"]*)` span), so the embedded grammar is clipped at the quote:
//    the cast stops, the `"` stays a string end, and `>ok</b>` recovers to HTML. Once thought
//    a pure-TM ceiling (semantic/Volar only); it isn't — capture-embed bounds it. ──
{
  const t = await tokenize('mono', '<template>\n  <b :value="msg as string">ok</b>\n</template>\n<script>const z = 1</script>');
  check('#5012: `msg as string` embeds as TS (the value)', !!find(t, 'as', s => s.includes('source.ts')));
  check('#5012 FIXED: the closing `"` is not eaten — `ok` after the value is HTML, not TS', !t.some(tk => tk.text === 'ok' && tk.scopes.includes('source.ts')));
  check('#5012 FIXED: `</b>` after the value recovers to HTML', !!find(t, 'b', s => s.includes('entity.name.tag') && !s.includes('source.ts')));
  check('#5012: <script> after </template> survives', !!find(t, 'const', s => s.includes('source.js') && s.includes('storage.type')));
}

// ── #3999 (GATED): a MULTI-LINE <script> start tag (force-expand-multiline formatting) must
//    still embed the body — a TextMate `begin` is single-line, so this needs the dedicated
//    multi-line-start-tag region (gen-tm emitRawMultiline), with lang= detected across lines. ──
{
  const t = await tokenize('mono', '<script\n  lang="ts"\n>\nconst mlx = 1\n</script>');
  check('#3999: multi-line <script lang="ts"> start tag — body still embeds as TS', !!find(t, 'const', s => s.includes('source.ts') && s.includes('storage.type')));
  const t2 = await tokenize('mono', '<script\n  setup\n>\nvar mly = 1\n</script>');
  check('#3999: multi-line <script> with no lang — body embeds as JS (default)', !!find(t2, 'var', s => s.includes('source.js')));
}

console.log(`\nvue-embed-boundary: ${pass}/${pass + fail} gated checks pass`);
if (fail > 0) { console.log('✗ embed boundary FAILED (expected RED until the begin/while fix lands)'); process.exit(1); }
console.log('✓ embed boundary: </script> ends the embed (#1666); #5012 directive-value cast bounded by capture-embed');
