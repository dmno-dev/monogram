// vue-issue-cases.ts — REAL highlighting issues reported against vuejs/language-tools'
// vue.tmLanguage.json, as DATA (no side effects on import). Single source shared by
// test/vue-issues.ts (the snapshot-gated bench) and test/issue-table.ts (the README
// cross-language ✓ table). Each id is the tracker #issue. See vue-issues.ts for the
// fetch/triage and the harness.

export const familyOf = (s: string): string =>
  s.includes('source.ts') ? 'ts' : s.includes('source.js') ? 'js'
    : s.includes('source.css') ? 'css' : s.includes('text.html') ? 'html' : 'other';
export const embedded = (s: string) => s.includes('source.ts') || s.includes('source.js');
export const htmlText = (s: string) => familyOf(s) === 'html';   // recovered to HTML (didn't leak into the embed)
export const DONE = '\n  <b>DONE</b>\n</template>';              // downstream marker — must recover to HTML

export interface Check { at: string; nth?: number; want: (s: string) => boolean; desc: string }
export interface Case { id: string; title: string; src: string; checks: Check[] }

export const cases: Case[] = [
  // ── TS operators inside template expressions — Monogram embeds proven TS, gets these free ──
  { id: '#3400', title: '`instanceof` in {{ }}', src: `<template>\n  <div>{{ err instanceof Error }}</div>${DONE}`,
    checks: [{ at: 'instanceof', want: embedded, desc: 'instanceof embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers to HTML' }] },
  { id: '#5370', title: '`typeof x !==` in v-if', src: `<template>\n  <p v-if="typeof x !== 'number'">a</p>${DONE}`,
    checks: [{ at: 'typeof', want: embedded, desc: 'typeof embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#5118', title: '`?.` / `??` in {{ }}', src: `<template>\n  <div>{{ a?.b ?? c }}</div>${DONE}`,
    checks: [{ at: '??', want: embedded, desc: 'nullish embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#1675', title: 'arrow `=>` in {{ }}', src: `<template>\n  <div>{{ items.map(i => i.id) }}</div>${DONE}`,
    checks: [{ at: '=>', want: embedded, desc: 'arrow embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#6039/#4741', title: '`<` operator in {{ }} (not a tag!)', src: `<template>\n  <div>{{ a < b }}</div>${DONE}`,
    checks: [{ at: 'DONE', want: htmlText, desc: 'the `<` is not mistaken for a tag — downstream recovers' }] },
  { id: '#5722', title: 'negated ternary + quotes in {{ }}', src: `<template>\n  <div>{{ !ok ? 'yes' : 'no' }}</div>${DONE}`,
    checks: [{ at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  // ── `as` type assertion (the #5012 intra-line ceiling family) ──
  { id: '#6007/#2096/#520', title: '`as` type assertion in directive value', src: `<template>\n  <Foo :schema="x as JSONSchema" />${DONE}`,
    checks: [{ at: 'as', want: embedded, desc: '`as` embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers (begin/while bounds it)' }] },
  // ── script / boundary family ──
  { id: '#5538/#2060', title: 'trailing `export type` before </script>', src: `<script lang="ts">\nexport type T = number\n</script>\n<template>\n  <p>hi</p>${DONE}`,
    checks: [{ at: 'hi', want: htmlText, desc: '</script> ends the embed — template is HTML' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#3999', title: 'multi-line <script> start-tag attributes', src: `<script\n  lang="ts"\n>\nconst x = 1\n</script>`,
    checks: [{ at: 'const', want: embedded, desc: 'body still embeds as TS across the multi-line tag' }] },
  // ── tag / interpolation edge cases ──
  { id: '#4769', title: 'tag name starting with `template`', src: `<template>\n  <templatex>{{ y }}</templatex>${DONE}`,
    checks: [{ at: 'y', want: embedded, desc: 'interpolation inside a template-prefixed tag works' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#5701', title: '`{{` inside a <script> string', src: `<script>\nconst s = "{{ not interp }}"\n</script>\n<template>\n  <p>{{ real }}</p>${DONE}`,
    checks: [{ at: 'real', want: embedded, desc: 'the real interpolation still embeds as TS' }, { at: 'DONE', want: htmlText, desc: 'downstream recovers' }] },
  { id: '#6070', title: 'capitalized component then a <style> block', src: `<template>\n  <MyComp @click="f">x</MyComp>\n</template>\n<style>\n.a { color: red }\n</style>`,
    checks: [{ at: 'color', want: s => familyOf(s) === 'css', desc: '<style> after a capitalized tag still embeds as CSS' }] },
];
