/**
 * Server-side locator healing — lookup alternatives for failing locators.
 *
 * Queries the normalized `locator_snapshots` table by test_case_id + location,
 * with fallback to fuzzy matching by locator fingerprint and ARIA snapshot
 * generation when no prior snapshot exists.
 */
import { eq } from 'drizzle-orm';
import { locatorSnapshots, testRunsCases, type LocatorSnapshotRow } from '../database/schema';
import { extractSelector, extractTopFrameFile } from '../../shared/error-fingerprint';
import { locatorSignatureFromExpression, locatorExpressionMethod } from '../../shared/locator-healing';
import type { RankedLocator } from '../../shared/locator-healing.types';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

export interface LocatorHealingResult {
  failingLocator: { method: string; args: Record<string, unknown> } | null;
  fromPriorSuccess: RankedLocator[] | null;
  fromAriaSnapshot: RankedLocator[] | null;
  source: 'prior-run' | 'fingerprint' | 'aria-snapshot' | 'none';
}

/**
 * Parse a Playwright locator expression into method + args.
 *
 * Examples:
 *   getByTestId('submit-btn') → { method: 'getByTestId', args: { testId: 'submit-btn' } }
 *   getByRole('button', { name: 'Submit' }) → { method: 'getByRole', args: { role: 'button', name: 'Submit' } }
 *   locator('.my-class') → { method: 'locator', args: { selector: '.my-class' } }
 */
function parseLocatorExpression(expr: string): {
  method: string;
  args: Record<string, unknown>;
} | null {
  const methodMatch = expr.match(/^(\w+)\(/);
  if (!methodMatch) return null;
  const method = methodMatch[1]!;

  const inner = expr.slice(method.length + 1, -1).trim();
  if (!inner) return { method, args: {} };

  const args: unknown[] = [];
  let i = 0;

  while (i < inner.length) {
    const ch = inner[i];
    if (ch === ',' || ch === ' ') {
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = findMatchingQuote(inner, i);
      args.push(inner.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    if (ch === '{') {
      const end = findMatchingBrace(inner, i);
      args.push(parseOptionsObject(inner.slice(i, end + 1)));
      i = end + 1;
      continue;
    }

    // Fallback: skip unknown token
    i++;
  }

  return normalizeParsedArgs(method, args);
}

function findMatchingQuote(s: string, start: number): number {
  const quote = s[start];
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return s.length - 1;
}

/**
 * Parse a Playwright option object as printed in error text, e.g.
 * `{ name: 'Submit', exact: true }`. This is NOT JSON — keys are unquoted and
 * strings use single quotes — so `JSON.parse` would throw. Values are read
 * loosely (string / boolean / number / regex) for display only; matching uses
 * the locator signature, not these parsed args.
 */
function parseOptionsObject(src: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const re = /(\w+)\s*:\s*('(?:\\.|[^'])*'|"(?:\\.|[^"])*"|true|false|-?\d+(?:\.\d+)?|\/(?:\\.|[^/])*\/[a-z]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const key = m[1]!;
    const raw = m[2]!;
    if (raw === 'true') obj[key] = true;
    else if (raw === 'false') obj[key] = false;
    else if (/^-?\d/.test(raw)) obj[key] = Number(raw);
    else if (raw.startsWith('/'))
      obj[key] = raw; // regex — keep as text for display
    else obj[key] = raw.slice(1, -1).replace(/\\(.)/g, '$1'); // unquote + unescape
  }
  return obj;
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return s.length - 1;
}

function normalizeParsedArgs(method: string, args: unknown[]): { method: string; args: Record<string, unknown> } {
  const obj: Record<string, unknown> = {};

  switch (method) {
    case 'getByTestId':
      obj.testId = args[0];
      break;
    case 'getByRole': {
      const role = args[0] as string | undefined;
      if (role) obj.role = role;
      const opts = (args[1] as Record<string, unknown>) ?? {};
      for (const [k, v] of Object.entries(opts)) {
        if (k !== 'exact') obj[k] = v;
      }
      break;
    }
    case 'getByText':
      obj.text = args[0];
      break;
    case 'getByLabel':
      obj.label = args[0];
      break;
    case 'getByPlaceholder':
      obj.placeholder = args[0];
      break;
    case 'getByAltText':
      obj.text = args[0];
      break;
    case 'getByTitle':
      obj.title = args[0];
      break;
    case 'locator':
      obj.selector = args[0];
      break;
    case 'page.locator':
      obj.selector = args[0];
      break;
    default:
      obj.args = args;
  }

  return { method, args: obj };
}

/**
 * Extract the call-site location from a Playwright error's stack trace.
 * Uses the first user-code frame (file not in node_modules).
 */
function extractErrorLocation(error: string): string | null {
  const topFrame = extractTopFrameFile(error);
  if (!topFrame) return null;

  // The error message contains stack frames like:
  //     at tests/checkout.spec.ts:42:5
  const frameMatch = error.match(/\s+at\s+([^(:\s]+\.[a-z]+):(\d+):(\d+)/i);
  if (frameMatch) {
    return `${frameMatch[1]}:${frameMatch[2]}:${frameMatch[3]}`;
  }

  return topFrame; // fallback: just the file
}

/**
 * Generate basic alternatives from ARIA snapshot text.
 * Limited — only role + name, label, placeholder, text. No HTML attrs.
 */
function generateFromAriaSnapshot(ariaSnapshot: string | null): RankedLocator[] | null {
  if (!ariaSnapshot) return null;

  const alts: RankedLocator[] = [];
  const seen = new Set<string>();

  const add = (l: RankedLocator) => {
    if (!seen.has(l.locator)) {
      seen.add(l.locator);
      alts.push(l);
    }
  };

  const lines = ariaSnapshot.split('\n');

  for (const line of lines) {
    // Parse "  - button \"Submit order\" [ref=e12]"
    const m = line.match(/- (\w+)(?:\s+"([^"]*)")?/);
    if (!m) continue;
    const role = m[1]!;
    const name = m[2] || null;

    if (name) {
      const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      add({
        locator: `getByRole('${role}', { name: '${esc(name)}' })`,
        method: 'getByRole',
        args: { role, name },
        score: 40,
      });

      if (['textbox', 'combobox', 'searchbox'].includes(role)) {
        add({
          locator: `getByLabel('${esc(name)}')`,
          method: 'getByLabel',
          args: { label: name },
          score: 35,
        });
      }
    }
  }

  if (alts.length === 0) return null;
  return alts.sort((a, b) => b.score - a.score);
}

/**
 * Find alternatives for a failing locator. Loads every snapshot for the test
 * case once (indexed by test_case_id) and resolves the best match in memory:
 *
 * 1. Call-site location — exact `file:line:col`, then `file:line` (tolerates a
 *    column drift). Disambiguates repeated identical locators by where they run.
 * 2. Locator signature — method + ordered string literals; survives line shifts
 *    but cannot tell apart repeated identical locators.
 * 3. ARIA fallback — generated from the current run's ARIA snapshot.
 */
export async function getLocatorHealing(db: DB, testRunsCaseId: number): Promise<LocatorHealingResult> {
  // Load the failing row
  const rows = await db
    .select({
      error: testRunsCases.error,
      testCaseId: testRunsCases.testCaseId,
      ariaSnapshot: testRunsCases.ariaSnapshot,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, testRunsCaseId));

  const row = rows[0];
  if (!row?.error) {
    return {
      failingLocator: null,
      fromPriorSuccess: null,
      fromAriaSnapshot: null,
      source: 'none',
    };
  }

  const error = row.error;
  const testCaseId = row.testCaseId;

  // Parse the failing locator from the error (for display + signature lookup)
  const selector = extractSelector(error);
  const parsedLocator = selector ? parseLocatorExpression(selector) : null;
  const failingLocator = parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null;
  const location = extractErrorLocation(error);

  // Load every snapshot for this test case once (indexed by test_case_id). A
  // case has only a handful of locators, so matching in memory is cheaper than
  // several round-trips and keeps the ladder logic in one place.
  const snaps = testCaseId
    ? await db.select().from(locatorSnapshots).where(eq(locatorSnapshots.testCaseId, testCaseId))
    : [];

  // Ladder 1: call-site location. Prefer an exact file:line:col match, then
  // fall back to file:line so a column drift between the runtime capture and
  // the error location still resolves. This is what disambiguates repeated
  // identical locators (e.g. two "Delete" buttons on different rows).
  if (location && snaps.length > 0) {
    const hit = snaps.find((s) => s.location === location) ?? snaps.find((s) => sameFileLine(s.location, location));
    if (hit) {
      return {
        failingLocator,
        fromPriorSuccess: parseAlternativesColumn(hit),
        fromAriaSnapshot: null,
        source: 'prior-run',
      };
    }
  }

  // Ladder 2: locator signature (method + ordered string literals) — survives
  // line shifts. Cannot tell apart repeated identical locators; returns the
  // first match.
  if (selector && snaps.length > 0) {
    const sig = await locatorSignatureFromExpression(selector);
    const method = locatorExpressionMethod(selector);
    const hit = snaps.find((s) => s.usedArgsFp === sig && (!method || s.usedMethod === method));
    if (hit) {
      return {
        failingLocator,
        fromPriorSuccess: parseAlternativesColumn(hit),
        fromAriaSnapshot: null,
        source: 'fingerprint',
      };
    }
  }

  // Ladder 3: ARIA snapshot fallback
  const ariaAlts = generateFromAriaSnapshot(row.ariaSnapshot ?? null);
  if (ariaAlts) {
    return { failingLocator, fromPriorSuccess: null, fromAriaSnapshot: ariaAlts, source: 'aria-snapshot' };
  }

  return { failingLocator, fromPriorSuccess: null, fromAriaSnapshot: null, source: 'none' };
}

/** Compare two `file:line:col` locations ignoring the trailing column. */
function sameFileLine(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return stripColumn(a) === stripColumn(b);
}

function stripColumn(loc: string): string {
  return loc.replace(/:\d+$/, '');
}

function parseAlternativesColumn(row: LocatorSnapshotRow): RankedLocator[] | null {
  try {
    return JSON.parse(row.alternatives) as RankedLocator[];
  } catch {
    return null;
  }
}
