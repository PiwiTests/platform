/**
 * The alternatives stored for each locator call site of one file: what an
 * editor offers to replace a brittle locator with, as of the last passing run.
 */
import { and, eq, like } from 'drizzle-orm';
import { callSiteFile, sameFilePath } from '@piwitests/core/locator-break';
import { locatorSnapshots, testCases } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import type { RankedLocator } from '#shared/locator-healing.types';

/** Alternatives kept per call site. */
const MAX_ALTERNATIVES = 10;

export interface CallSiteAlternatives {
  testCaseId: number;
  /** The call site, `file:line:col`, as captured. */
  location: string;
  /** The method the call used (`getByRole`, `locator`, …). */
  method: string;
  alternatives: RankedLocator[];
  /** When the call site last passed with the capture fixtures, ISO 8601. */
  lastSeenAt: string;
}

function parseAlternatives(raw: unknown): RankedLocator[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is RankedLocator => !!a && typeof a === 'object' && typeof (a as RankedLocator).locator === 'string',
      )
      .slice(0, MAX_ALTERNATIVES);
  } catch {
    return [];
  }
}

/** The stored alternatives of every call site in `file` (a path or a path suffix), newest capture first. */
export async function getLocatorAlternatives(
  db: DrizzleDB,
  projectId: number,
  file: string,
): Promise<CallSiteAlternatives[]> {
  const base = file.replace(/\\/g, '/').split('/').pop() ?? file;
  const rows = await db
    .select({
      testCaseId: locatorSnapshots.testCaseId,
      location: locatorSnapshots.location,
      method: locatorSnapshots.usedMethod,
      alternatives: locatorSnapshots.alternatives,
      lastSeenAt: locatorSnapshots.lastSeenAt,
    })
    .from(locatorSnapshots)
    .innerJoin(testCases, eq(locatorSnapshots.testCaseId, testCases.id))
    .where(and(eq(testCases.projectId, projectId), like(locatorSnapshots.location, `%${base}:%`)));
  return rows
    .filter((r) => r.location && sameFilePath(callSiteFile(r.location), file))
    .map((r) => ({
      testCaseId: r.testCaseId,
      location: r.location!,
      method: r.method ?? '',
      alternatives: parseAlternatives(r.alternatives),
      lastSeenAt: new Date(r.lastSeenAt ?? 0).toISOString(),
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}
