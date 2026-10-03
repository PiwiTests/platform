/**
 * Impact-from-diff — map a set of changed files to the tests they affect,
 * resolved through observed edges rather than a build-time dependency graph.
 *
 * Three edges, all cheap and config-free:
 *  1. **Direct** — a changed file that IS a test file → the tests defined in it.
 *  2. **Reach** — a changed support file (page object, helper, app module) that
 *     a test's most recent execution ran through, per its captured
 *     `test_source_frames`.
 *  3. **Code reach** — a changed application file whose functions a test
 *     executed (`code_reach`), or the handler file of a route a test called.
 *
 * Honest by construction: it degrades in the safe direction, widening to the
 * full suite (with a warning) rather than silently skipping a test:
 *  - A changed file that maps to no test can't be ruled out, unless it is
 *    documentation (`DOCUMENTATION_EXTENSIONS`). Styles, markup, JSON and YAML
 *    widen too: no edge maps them.
 *  - A changed file mapped only through source frames widens. Source frames are
 *    recorded on failure only, so they name the tests that failed inside the
 *    file, never the passing tests that also use it.
 * Code reach only adds tests: it leaves out module top-level code, server
 * modules and type-only modules, so a file it never saw may still be run by
 * every test.
 */
import { eq, sql } from 'drizzle-orm';
import { testCases, testRunsCases } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { resolveCasePayloadContents } from './case-payloads';
import { sameFilePath } from '@piwitests/core/locator-break';
import { loadCodeReachPairs } from './code-reach';
import { resolveSelectionDefinition } from '#shared/handlers/selections';
import type { ResolvedSelection, SelectionDefinition, SelectionFormat, SelectionRankBy } from '#shared/selection';

/** Documentation extensions: a changed file with one of these that maps to no test runs nothing. */
const DOCUMENTATION_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'txt', 'rst', 'adoc']);

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function fileExtension(p: string): string {
  const match = p.match(/\.([a-z0-9]+)$/i);
  return match ? match[1]!.toLowerCase() : '';
}

/** Two repo-relative paths match when equal or one is a path-suffix of the other. */
function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

/** Per-test set of in-project files its most recent execution ran through. */
async function loadSourceReach(db: DrizzleDB, projectId: number): Promise<Map<number, string[]>> {
  const ranked = db.$with('ranked').as(
    db
      .select({
        testCaseId: testRunsCases.testCaseId,
        frames: testRunsCases.testSourceFrames,
        framesPayloadId: testRunsCases.testSourceFramesPayloadId,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${testRunsCases.testCaseId} ORDER BY ${testRunsCases.createdAt} DESC, ${testRunsCases.id} DESC)`.as(
          'rn',
        ),
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testCases.projectId, projectId)),
  );

  const rows: any[] = await db
    .with(ranked)
    .select({ testCaseId: ranked.testCaseId, frames: ranked.frames, framesPayloadId: ranked.framesPayloadId })
    .from(ranked)
    .where(sql`${ranked.rn} = 1`);

  const payloads = await resolveCasePayloadContents(
    db,
    rows.map((r) => r.framesPayloadId),
  );
  const reach = new Map<number, string[]>();
  for (const row of rows) {
    let frames: unknown = row.frames;
    if (row.framesPayloadId != null && payloads.has(row.framesPayloadId)) {
      try {
        frames = JSON.parse(payloads.get(row.framesPayloadId)!);
      } catch {
        // Malformed payload — fall back to whatever the inline column held.
      }
    }
    if (!Array.isArray(frames)) continue;
    const files = [
      ...new Set(
        frames
          .map((f) => (f && typeof f === 'object' ? (f as { file?: unknown }).file : undefined))
          .filter((f): f is string => typeof f === 'string')
          .map(normalizePath),
      ),
    ];
    if (files.length > 0) reach.set(Number(row.testCaseId), files);
  }
  return reach;
}

export interface ImpactResolution extends ResolvedSelection {
  impact: {
    changedFiles: number;
    /** Changed files that mapped to at least one test. */
    mappedFiles: number;
    /** True when files that could not be fully mapped forced a full-suite run. */
    widened: boolean;
    /** Changed files that forced the full suite (capped): mapped to no test, or only through source frames. */
    unmappedSourceFiles: string[];
  };
}

/**
 * Resolve which tests a set of changed files impacts, then materialize a command
 * for them via the normal resolver (through an `ids` selection, or the whole
 * suite when widening).
 */
export async function resolveImpact(
  db: DrizzleDB,
  projectId: number,
  changedFiles: string[],
  options: { format?: SelectionFormat; shard?: { index: number; total: number }; order?: SelectionRankBy } = {},
): Promise<ImpactResolution> {
  const files = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];

  const cases = await db
    .select({ id: testCases.id, filePath: testCases.filePath })
    .from(testCases)
    .where(eq(testCases.projectId, projectId));
  const reach = await loadSourceReach(db, projectId);
  const codeReach = await loadCodeReachPairs(db, projectId);

  const matched = new Set<number>();
  const mappedFiles = new Set<string>();
  // Files mapped by an edge that names every test using them: the test file itself, or code reach.
  const fullyMappedFiles = new Set<string>();

  for (const testCase of cases) {
    const filePath = normalizePath(testCase.filePath);
    for (const changed of files) {
      if (pathsMatch(filePath, changed)) {
        matched.add(testCase.id);
        mappedFiles.add(changed);
        fullyMappedFiles.add(changed);
      }
    }
  }
  for (const [caseId, reachedFiles] of reach) {
    for (const changed of files) {
      if (reachedFiles.some((reached) => pathsMatch(reached, changed))) {
        matched.add(caseId);
        mappedFiles.add(changed);
      }
    }
  }

  // Many tests reach the same files: match each distinct file once.
  const testsByFile = new Map<string, Set<number>>();
  for (const pair of codeReach) {
    const tests = testsByFile.get(pair.file);
    if (tests) tests.add(pair.testCaseId);
    else testsByFile.set(pair.file, new Set([pair.testCaseId]));
  }
  for (const [file, tests] of testsByFile) {
    for (const changed of files) {
      if (!sameFilePath(file, changed)) continue;
      for (const id of tests) matched.add(id);
      mappedFiles.add(changed);
      fullyMappedFiles.add(changed);
    }
  }

  const unmapped = files.filter((f) => !mappedFiles.has(f) && !DOCUMENTATION_EXTENSIONS.has(fileExtension(f)));
  const framesOnly = files.filter((f) => mappedFiles.has(f) && !fullyMappedFiles.has(f));
  const widening = [...unmapped, ...framesOnly];
  const widened = widening.length > 0;

  const definition: SelectionDefinition = widened ? {} : { include: [{ ids: [...matched] }] };
  const resolved = await resolveSelectionDefinition(db, projectId, definition, {
    key: 'impact',
    version: 0,
    format: options.format,
    shard: options.shard,
    order: options.order,
  });

  if (widened) {
    const reasons: string[] = [];
    if (unmapped.length > 0) {
      reasons.push(`${unmapped.length} changed file${unmapped.length === 1 ? '' : 's'} mapped to no test`);
    }
    if (framesOnly.length > 0) {
      reasons.push(
        `${framesOnly.length} changed file${framesOnly.length === 1 ? '' : 's'} mapped only through failure frames, which miss the passing tests that use ${framesOnly.length === 1 ? 'it' : 'them'}`,
      );
    }
    resolved.warnings.push({
      code: 'impact-widened',
      message: `${reasons.join('; ')} — running the full suite: ${widening.slice(0, 5).join(', ')}`,
    });
  }

  return {
    ...resolved,
    impact: {
      changedFiles: files.length,
      mappedFiles: mappedFiles.size,
      widened,
      unmappedSourceFiles: widening.slice(0, 50),
    },
  };
}
