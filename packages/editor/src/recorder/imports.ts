/**
 * The names a file's import statements bind, read with the scanner of `page-candidates.ts`, and the import lines a
 * rendering needs that a file lacks.
 */
import { tokenize, type Token } from './page-candidates.js';

const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

function isPunct(token: Token | undefined, text: string): boolean {
  return token?.kind === 'punct' && token.text === text;
}

function isName(token: Token | undefined, text?: string): boolean {
  return token?.kind === 'name' && (text === undefined || token.text === text);
}

/**
 * The local names the import statements at the top level of a file bind: a default import, `* as NS`, each named
 * import under its local name (`B` for `A as B`, `D` for `type D`), with or without `import type`, and the name of
 * `import X = require('…')`. `import '…'` binds none, and neither do `import(…)`, `import.meta` and `require`.
 */
export function importedNames(text: string): Set<string> {
  const tokens = tokenize(text);
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'punct' && OPENERS.has(t.text)) depth++;
    else if (t.kind === 'punct' && CLOSERS.has(t.text)) depth = Math.max(0, depth - 1);
    if (depth > 0 || !isName(t, 'import') || isPunct(tokens[i - 1], '.') || isPunct(tokens[i - 1], '?.')) continue;
    let j = i + 1;
    if (isPunct(tokens[j], '(') || isPunct(tokens[j], '.')) continue;
    // `import type { A }`, `import type A from`, `import type * as NS`; but `import type from '…'` imports `type`.
    if (isName(tokens[j], 'type') && (isPunct(tokens[j + 1], '{') || isPunct(tokens[j + 1], '*'))) j++;
    else if (isName(tokens[j], 'type') && isName(tokens[j + 1]) && !isName(tokens[j + 1], 'from')) j++;
    if (isName(tokens[j]) && !isName(tokens[j], 'from')) {
      names.add(tokens[j]!.text);
      j++;
      if (!isPunct(tokens[j], ',')) continue;
      j++;
    }
    if (isPunct(tokens[j], '*') && isName(tokens[j + 1], 'as') && isName(tokens[j + 2])) {
      names.add(tokens[j + 2]!.text);
    } else if (isPunct(tokens[j], '{')) {
      // Each member's local name is its last token: `a`, `a as b`, `type d`, `'x-y' as z`, `default as e`.
      let last: Token | undefined;
      for (j++; j < tokens.length && !isPunct(tokens[j], '}'); j++) {
        if (isPunct(tokens[j], ',')) {
          if (isName(last)) names.add(last!.text);
          last = undefined;
        } else {
          last = tokens[j];
        }
      }
      if (isName(last)) names.add(last!.text);
      i = j;
    }
  }
  return names;
}

/**
 * The import lines whose names `text` does not bind yet, in their order: a line binding a name the file's imports
 * lack is kept whole. A line that binds no name is kept.
 */
export function missingImports(text: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const bound = importedNames(text);
  return lines.filter((line) => {
    const names = [...importedNames(line)];
    return names.length === 0 || names.some((name) => !bound.has(name));
  });
}
