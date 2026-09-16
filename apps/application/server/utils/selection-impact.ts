/**
 * Impact-from-diff — map a set of changed files to the tests they affect,
 * resolved through observed edges rather than a build-time dependency graph.
 *
 * Two edges, both cheap and config-free:
 *  1. **Direct** — a changed file that IS a test file → the tests defined in it.
 *  2. **Reach** — a changed support file (page object, helper, app module) that
 *     a test's most recent execution actually ran through, per its captured
 *     `test_source_frames`.
 *
 * Honest by construction: it degrades in the safe direction. A changed *source*
 * file that maps to no test can't be ruled out, so the selection widens to the
 * full suite (with a warning) rather than silently skipping it. Route/page-level
 * mapping (server routes → tests that hit them) needs a per-project config and
 * is intentionally not attempted here.
 */
import { eq, sql } from 'drizzle-orm';
import { testCases, testRunsCases } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { resolveCasePayloadContents } from './case-payloads';
import { resolveSelectionDefinition } from '#shared/handlers/selections';
import type { ResolvedSelection, SelectionDefinition, SelectionFormat, SelectionRankBy } from '#shared/selection';

/** Extensions we treat as source: an unmapped one of these widens to full suite. */
const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'astro',
  'py',
  'rb',
  'go',
  'java',
  'cs',
  'php',
  'kt',
]);

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
    /** True when unmapped source files forced a full-suite run. */
    widened: boolean;
    /** Source files that mapped to no test (capped). */
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

  const matched = new Set<number>();
  const mappedFiles = new Set<string>();

  for (const testCase of cases) {
    const filePath = normalizePath(testCase.filePath);
    for (const changed of files) {
      if (pathsMatch(filePath, changed)) {
        matched.add(testCase.id);
        mappedFiles.add(changed);
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

  const unmappedSource = files.filter((f) => !mappedFiles.has(f) && SOURCE_EXTENSIONS.has(fileExtension(f)));
  const widened = unmappedSource.length > 0;

  const definition: SelectionDefinition = widened ? {} : { include: [{ ids: [...matched] }] };
  const resolved = await resolveSelectionDefinition(db, projectId, definition, {
    key: 'impact',
    version: 0,
    format: options.format,
    shard: options.shard,
    order: options.order,
  });

  if (widened) {
    const sample = unmappedSource.slice(0, 5).join(', ');
    resolved.warnings.push({
      code: 'impact-widened',
      message: `${unmappedSource.length} changed source file${unmappedSource.length === 1 ? '' : 's'} could not be mapped to any test — running the full suite: ${sample}`,
    });
  }

  return {
    ...resolved,
    impact: {
      changedFiles: files.length,
      mappedFiles: mappedFiles.size,
      widened,
      unmappedSourceFiles: unmappedSource.slice(0, 50),
    },
  };
}
