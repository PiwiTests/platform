/**
 * Search predicates that ignore case and accents in the database, the way
 * `foldText` (`#shared/utils/fold-text`) does in memory. Neither database
 * strips accents and SQLite's `lower()` folds ASCII letters only, so the
 * searched value is folded here and each of its letters becomes a class of
 * every character that folds to it (`e` → `[eEéÉèÈ…]`): a GLOB pattern on
 * SQLite, a regular expression on PostgreSQL. On SQLite a plain `LIKE` answers
 * for ASCII values, and the GLOB runs only on values that hold other characters.
 *
 * A value stored decomposed (a letter followed by a combining accent) is not
 * matched across its accent; text from source files is composed.
 */
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { escapeLikePattern } from '#shared/utils/tag-filter';
import { foldText } from '#shared/utils/fold-text';

/** The blocks whose accented letters the classes cover: Latin, Greek and Cyrillic. */
const ACCENTED_RANGES: ReadonlyArray<[number, number]> = [
  [0x41, 0x5a],
  [0xc0, 0x24f],
  [0x370, 0x4ff],
  [0x1e00, 0x1fff],
];

let variants: Map<string, string> | null = null;

/** Every character that folds to `char` other than itself, upper case included. */
function variantsOf(char: string): string {
  if (!variants) {
    variants = new Map();
    for (const [from, to] of ACCENTED_RANGES) {
      for (let code = from; code <= to; code++) {
        const original = String.fromCodePoint(code);
        const folded = foldText(original);
        if (folded !== original && [...folded].length === 1) {
          variants.set(folded, (variants.get(folded) ?? '') + original);
        }
      }
    }
  }
  const known = variants.get(char) ?? '';
  const upper = char.toUpperCase();
  return upper !== char && [...upper].length === 1 && !known.includes(upper) ? upper + known : known;
}

function globPart(text: string): string {
  let out = '';
  for (const char of text) {
    const others = variantsOf(char);
    if (others) out += `[${char}${others}]`;
    else out += char === '*' || char === '?' || char === '[' ? `[${char}]` : char;
  }
  return out;
}

function regexPart(text: string): string {
  let out = '';
  for (const char of text) {
    const others = variantsOf(char);
    out += others ? `[${char}${others}]` : char.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
  }
  return out;
}

/** The switch the schema barrel (`server/database/schema.ts`) reads; unset in the demo. */
function onPostgres(): boolean {
  return typeof process !== 'undefined' && !!process.env?.PIWI_DATABASE_URL;
}

/** `parts` in order in `column` with anything between them; `whole` anchors them to both ends. */
function foldedMatch(column: SQLWrapper, parts: readonly string[], whole: boolean): SQL {
  const folded = parts.map(foldText);
  if (onPostgres()) {
    const body = folded.map(regexPart).join('.*');
    return sql`${column} ~ ${whole ? `^${body}$` : body}`;
  }
  const like = folded.map(escapeLikePattern).join('%');
  const glob = folded.map(globPart).join('*');
  return sql`(lower(${column}) LIKE ${whole ? like : `%${like}%`} ESCAPE '\\' OR (length(${column}) <> length(CAST(${column} AS BLOB)) AND ${column} GLOB ${whole ? glob : `*${glob}*`}))`;
}

/** `column` contains `value`, ignoring case and accents. With `wildcard`, a `*` in `value` stands for any characters. */
export function foldedContains(column: SQLWrapper, value: string, options: { wildcard?: boolean } = {}): SQL {
  return foldedMatch(column, options.wildcard ? value.split('*') : [value], false);
}

/** `column` is `value`, ignoring case and accents. */
export function foldedEquals(column: SQLWrapper, value: string): SQL {
  return foldedMatch(column, [value], true);
}
