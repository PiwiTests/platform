/**
 * The search language of the test lists (`#shared/test-search`) as SQL
 * predicates, for a list the server pages. It follows the in-memory matcher
 * term for term: text fields match anywhere inside the value with `*` as a
 * wildcard, the others match a whole value, case never matters, and repeated
 * single-value qualifiers widen.
 *
 * Both sides of every comparison go through the database's own `lower()`, so
 * a value typed in the stored case always matches (SQLite only folds ASCII
 * letters). A NULL column compares as an empty value, so an exclusion
 * (`-owner:alice`) keeps the rows with no value, as the in-memory matcher does.
 */
import { not, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { escapeLikePattern } from '#shared/utils/tag-filter';
import { freeTextFields, testSearchFieldDef, type TestSearchField, type TestSearchQuery } from '#shared/test-search';

/**
 * The column behind each qualifier. `describe` is the describe path with its
 * blocks joined by `\x1f`; `tag` and `lock` are JSON arrays of strings (tags
 * without their `@`). A field without a column matches nothing.
 */
export type TestSearchColumns = Partial<Record<TestSearchField, SQLWrapper>>;

const JSON_ARRAY_FIELDS: ReadonlySet<TestSearchField> = new Set(['tag', 'lock']);

/** `value` anywhere in the column, `*` as a wildcard. */
function containsPredicate(column: SQLWrapper, value: string): SQL {
  const pattern = `%${escapeLikePattern(value).replace(/\*/g, '%')}%`;
  return sql`lower(COALESCE(${column}, '')) LIKE lower(${pattern}) ESCAPE '\\'`;
}

/** The column holds exactly `value`. */
function exactPredicate(column: SQLWrapper, value: string): SQL {
  return sql`lower(COALESCE(${column}, '')) = lower(${value})`;
}

/** The JSON array column has an element equal to `value`: the JSON-encoded element, quotes included. */
function arrayElementPredicate(column: SQLWrapper, value: string): SQL {
  const pattern = `%${escapeLikePattern(JSON.stringify(value))}%`;
  return sql`lower(COALESCE(CAST(${column} AS TEXT), '')) LIKE lower(${pattern}) ESCAPE '\\'`;
}

function fieldPredicate(field: TestSearchField, value: string, columns: TestSearchColumns): SQL | null {
  const column = columns[field];
  if (!column) return null;
  if (JSON_ARRAY_FIELDS.has(field)) return arrayElementPredicate(column, value);
  return testSearchFieldDef(field).match === 'contains'
    ? containsPredicate(column, value)
    : exactPredicate(column, value);
}

/** The conditions a query adds to a WHERE clause, to be combined with AND. */
export function testSearchConditions(query: TestSearchQuery, columns: TestSearchColumns): SQL[] {
  const conditions: SQL[] = [];
  const anyOf = new Map<TestSearchField, SQL[]>();
  const free = freeTextFields(query.fields);
  for (const term of query.terms) {
    let predicate: SQL | null;
    if (term.field === null) {
      const parts = free.map((field) => fieldPredicate(field, term.value, columns)).filter((p): p is SQL => !!p);
      predicate = parts.length > 0 ? or(...parts)! : null;
    } else {
      predicate = fieldPredicate(term.field, term.value, columns);
    }
    if (term.negated) {
      if (predicate) conditions.push(not(predicate));
    } else if (!predicate) {
      conditions.push(sql`1 = 0`);
    } else if (term.field && testSearchFieldDef(term.field).single) {
      const group = anyOf.get(term.field) ?? [];
      group.push(predicate);
      anyOf.set(term.field, group);
    } else {
      conditions.push(predicate);
    }
  }
  for (const group of anyOf.values()) conditions.push(group.length === 1 ? group[0]! : or(...group)!);
  return conditions;
}
