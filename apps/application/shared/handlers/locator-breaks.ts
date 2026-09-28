/**
 * Locator breaks on the server: the locators a pull request's diff breaks,
 * predicted from the provider's per-file patches against the locator index of
 * the pull request's base branch, stored per run, and shaped for the comment
 * and for locator healing's `diff-rename` rung.
 *
 * The prediction is `predictLocatorBreaks` from `@piwitests/core`, the same
 * function `piwi preflight` runs locally. The server reads patches only, so a
 * template whose translation key changed is not resolved here.
 */

import { eq, inArray } from 'drizzle-orm';
import { diffFileFromPatch, extractDiffAnchors, parseUnifiedDiff, type DiffAnchor } from '@piwitests/core/diff-anchors';
import { predictLocatorBreaks, type LocatorBreak } from '@piwitests/core/locator-break';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import { runLocatorBreaks, testRunsCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import type { PrLocatorBreak, PrLocatorBreaks } from '../pr-feedback';

/** Spec and test files, skipped as change sources: a change there edits the locator itself. */
const TEST_FILE = /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/;

/** A changed file as an SCM provider returns it. */
export interface PatchedFile {
  filename: string;
  status?: string;
  patch?: string;
}

/** One stored break of a run. */
export interface RunLocatorBreak {
  locator: string;
  rewrite: string | null;
  replacements: Array<[string, string]>;
  anchor: DiffAnchor;
  confidence: 'likely' | 'possible';
  callSites: string[];
  testCaseIds: number[];
}

/** The breaks the provider's patches predict against an index. */
export function predictPatchBreaks(files: PatchedFile[], index: LocatorIndex): LocatorBreak[] {
  const parsed = files
    .filter((f) => f.patch && f.status !== 'removed' && f.status !== 'deleted')
    .map((f) => diffFileFromPatch(f.filename, f.patch!));
  const anchors = extractDiffAnchors(parsed, {
    testIdAttributes: index.testIdAttributes ?? undefined,
    isTestFile: (file) => TEST_FILE.test(file),
  });
  return predictLocatorBreaks(anchors, index);
}

/** The breaks a whole unified diff (`git diff` output) predicts against an index. */
export function predictDiffBreaks(diff: string, index: LocatorIndex): LocatorBreak[] {
  const anchors = extractDiffAnchors(parseUnifiedDiff(diff), {
    testIdAttributes: index.testIdAttributes ?? undefined,
    isTestFile: (file) => TEST_FILE.test(file),
  });
  return predictLocatorBreaks(anchors, index);
}

/** A break as stored: its call sites ordered by how many tests use each. */
export function toRunLocatorBreak(b: LocatorBreak): RunLocatorBreak {
  const bySite = new Map<string, number>();
  for (const use of b.uses) for (const site of use.callSites) bySite.set(site, (bySite.get(site) ?? 0) + 1);
  return {
    locator: b.locator,
    rewrite: b.rewrite ?? null,
    replacements: b.replacements ?? [],
    anchor: b.anchor,
    confidence: b.confidence,
    callSites: [...bySite].sort((a, c) => c[1] - a[1]).map(([site]) => site),
    testCaseIds: b.tests.map((t) => t.id),
  };
}

/** Replace a run's stored breaks. */
export async function storeRunLocatorBreaks(
  db: DrizzleDB,
  runId: number,
  projectId: number,
  breaks: RunLocatorBreak[],
): Promise<void> {
  await db.delete(runLocatorBreaks).where(eq(runLocatorBreaks.runId, runId));
  if (breaks.length === 0) return;
  const rows = breaks.map((b) => ({
    runId,
    projectId,
    locator: b.locator,
    rewrite: b.rewrite,
    replacements: b.replacements,
    anchor: b.anchor,
    confidence: b.confidence,
    callSites: b.callSites,
    testCaseIds: b.testCaseIds,
  }));
  for (let i = 0; i < rows.length; i += 200) await db.insert(runLocatorBreaks).values(rows.slice(i, i + 200));
}

/** A run's stored breaks. */
export async function loadRunLocatorBreaks(db: DrizzleDB, runIds: number[]): Promise<Map<number, RunLocatorBreak[]>> {
  const out = new Map<number, RunLocatorBreak[]>();
  if (runIds.length === 0) return out;
  const rows = await db.select().from(runLocatorBreaks).where(inArray(runLocatorBreaks.runId, runIds));
  for (const r of rows) {
    const list = out.get(r.runId) ?? [];
    list.push({
      locator: r.locator,
      rewrite: r.rewrite ?? null,
      replacements: (r.replacements as Array<[string, string]> | null) ?? [],
      anchor: r.anchor as DiffAnchor,
      confidence: r.confidence === 'likely' ? 'likely' : 'possible',
      callSites: (r.callSites as string[] | null) ?? [],
      testCaseIds: (r.testCaseIds as number[] | null) ?? [],
    });
    out.set(r.runId, list);
  }
  return out;
}

/** Statuses a case can carry without having executed. */
const NOT_RUN = new Set(['skipped', 'didnotrun']);

/** The test cases that executed in a run. */
export async function loadRanTestCaseIds(db: DrizzleDB, runId: number): Promise<Set<number>> {
  const rows = await db
    .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, runId));
  return new Set(rows.filter((r) => !NOT_RUN.has(String(r.status).toLowerCase())).map((r) => r.testCaseId));
}

/**
 * The comment's section: the likely breaks none of whose tests executed in
 * the run. A break whose test failed is already listed with its failure; one
 * whose tests passed was updated with the change.
 */
export function toPrLocatorBreaks(
  breaks: RunLocatorBreak[],
  ranTestCaseIds: Set<number>,
  baseBranch: string | null,
): PrLocatorBreaks {
  const unexercised = breaks.filter((b) => !b.testCaseIds.some((id) => ranTestCaseIds.has(id)));
  const listed: PrLocatorBreak[] = unexercised
    .filter((b) => b.confidence === 'likely')
    .map((b) => ({
      locator: b.locator,
      rewrite: b.rewrite,
      file: b.anchor.file,
      line: b.anchor.line,
      before: b.anchor.before,
      after: b.anchor.after ?? null,
      key: b.anchor.key ?? null,
      testCount: b.testCaseIds.length,
      callSites: b.callSites,
    }));
  return {
    breaks: listed,
    possible: unexercised.filter((b) => b.confidence === 'possible').length,
    baseBranch,
  };
}
