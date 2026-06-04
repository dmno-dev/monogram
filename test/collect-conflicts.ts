// Regenerates the LR(1) conflict closure that `src/gen-treesitter.ts` feeds tree-sitter.
//
// This grammar is highly ambiguous, so tree-sitter needs an explicit `conflicts` entry
// for every LR(1) state it can't resolve alone. The standard authoring loop is: run
// `tree-sitter generate`, read its "Add a conflict for these rules: …" suggestion, add
// it, repeat to a fixpoint. This script automates that loop for EVERY derived grammar
// (CI only builds the typescript + html tree-sitters, so tsx/js/jsx conflicts would
// otherwise go unnoticed) and prints the tuples to add to LR_CONFLICT_CLOSURE.
//
// Run after a grammar change that makes `npm run gate:treesitter` fail to generate:
//   node test/collect-conflicts.ts
// then paste any printed tuples into LR_CONFLICT_CLOSURE and re-run `npm run gen`.
// It restores each grammar.js afterwards, so it never leaves the tree dirty.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const tsDir = `${root}tree-sitter`;
const langs = readdirSync(tsDir).filter(l => existsSync(`${tsDir}/${l}/grammar.js`));
const union = new Map<string, string[]>(); // canonical key -> tuple

for (const lang of langs) {
  const dir = `${tsDir}/${lang}`;
  const gj = `${dir}/grammar.js`;
  const backup = readFileSync(gj, 'utf8');
  const found: string[][] = [];
  try {
    for (let i = 0; i < 80; i++) {
      let out = '';
      try {
        execSync('npx tree-sitter generate', { cwd: dir, stdio: 'pipe' });
        break; // generates cleanly — no (more) missing conflicts
      } catch (e) {
        out = `${(e as any).stdout || ''}\n${(e as any).stderr || ''}`;
      }
      const m = out.match(/Add a conflict for these rules:\s*([^\n]+)/);
      if (!m) {
        // Not a conflict — e.g. yaml's generated grammar.js is not loadable by
        // tree-sitter (a pre-existing gen-treesitter regex-emission issue, and yaml's
        // tree-sitter is neither built nor gated). Skip it rather than dump a trace.
        const why = /Failed to load grammar|SyntaxError/.test(out) ? 'grammar.js not loadable' : 'unparseable generate error';
        console.error(`[${lang}] skipped — ${why}`);
        break;
      }
      const rules = [...m[1].matchAll(/`([a-z0-9_]+)`/g)].map(x => x[1]);
      if (!rules.length) break;
      found.push(rules);
      const src = readFileSync(gj, 'utf8').replace(
        /conflicts:\s*\$\s*=>\s*\[/,
        mm => `${mm}\n    [${rules.map(r => `$.${r}`).join(', ')}],`,
      );
      writeFileSync(gj, src);
    }
  } finally {
    writeFileSync(gj, backup); // discovery must not dirty the tree
  }
  for (const t of found) union.set([...t].sort().join('|'), t);
  console.error(`[${lang}] ${found.length} missing conflict tuple(s)`);
}

if (union.size === 0) {
  console.log('\n✓ every derived tree-sitter grammar already generates — closure is complete.');
} else {
  console.log('\n// add these to LR_CONFLICT_CLOSURE in src/gen-treesitter.ts:');
  for (const t of union.values()) console.log(`  [${t.map(r => `'${r}'`).join(', ')}],`);
}
