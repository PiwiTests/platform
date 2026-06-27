/**
 * Server-side locator healing — lookup alternatives for failing locators.
 *
 * Queries the normalized `locator_snapshots` table by test_case_id + location,
 * with fallback to fuzzy matching by locator fingerprint and ARIA snapshot
 * generation when no prior snapshot exists.
 */
import { and, eq } from 'drizzle-orm';
import { locatorSnapshots, testRunsCases, type LocatorSnapshotRow } from '../database/schema';
import { extractSelector, extractTopFrameFile } from '../../shared/error-fingerprint';
import { normalizeAndHashArgs } from '../../shared/locator-healing';
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
      try {
        args.push(JSON.parse(inner.slice(i, end + 1)));
      } catch {
        args.push(inner.slice(i, end + 1));
      }
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
 * Query the locator_snapshots table for alternatives to a failing locator.
 *
 * Lookup ladder:
 * 1. Exact: `WHERE test_case_id = ? AND location = ?` — fast indexed match
 * 2. Fingerprint: `WHERE test_case_id = ? AND used_method = ? AND used_args_fp = ?`
 *    — survives line shifts
 * 3. ARIA fallback: generate from current run's ARIA snapshot
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

  // Parse the failing locator from the error
  const selector = extractSelector(error);
  const parsedLocator = selector ? parseLocatorExpression(selector) : null;
  const location = extractErrorLocation(error);

  // Ladder 1: Exact location match
  if (location && testCaseId) {
    const snapRows = await db
      .select()
      .from(locatorSnapshots)
      .where(and(eq(locatorSnapshots.testCaseId, testCaseId), eq(locatorSnapshots.location, location)));

    if (snapRows.length > 0) {
      const alternatives = parseAlternativesColumn(snapRows[0]!);
      return {
        failingLocator: parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null,
        fromPriorSuccess: alternatives,
        fromAriaSnapshot: null,
        source: 'prior-run',
      };
    }
  }

  // Ladder 2: Fingerprint match (survives line shifts)
  if (parsedLocator && testCaseId) {
    const argsFp = await normalizeAndHashArgs(Object.values(parsedLocator.args));

    const snapRows = await db
      .select()
      .from(locatorSnapshots)
      .where(
        and(
          eq(locatorSnapshots.testCaseId, testCaseId),
          eq(locatorSnapshots.usedMethod, parsedLocator.method),
          eq(locatorSnapshots.usedArgsFp, argsFp),
        ),
      );

    if (snapRows.length > 0) {
      // If multiple matches (same locator used at different positions),
      // return the first one — spatial disambiguation would need the
      // failing test's sibling locator positions.
      const alternatives = parseAlternativesColumn(snapRows[0]!);
      return {
        failingLocator: {
          method: parsedLocator.method,
          args: parsedLocator.args,
        },
        fromPriorSuccess: alternatives,
        fromAriaSnapshot: null,
        source: 'fingerprint',
      };
    }
  }

  // Ladder 3: ARIA snapshot fallback
  const ariaAlts = generateFromAriaSnapshot(row.ariaSnapshot ?? null);
  if (ariaAlts) {
    return {
      failingLocator: parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null,
      fromPriorSuccess: null,
      fromAriaSnapshot: ariaAlts,
      source: 'aria-snapshot',
    };
  }

  return {
    failingLocator: parsedLocator ? { method: parsedLocator.method, args: parsedLocator.args } : null,
    fromPriorSuccess: null,
    fromAriaSnapshot: null,
    source: 'none',
  };
}

function parseAlternativesColumn(row: LocatorSnapshotRow): RankedLocator[] | null {
  try {
    return JSON.parse(row.alternatives) as RankedLocator[];
  } catch {
    return null;
  }
}
