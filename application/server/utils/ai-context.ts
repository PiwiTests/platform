import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import {
  testRunsCases,
  testCases,
  testRuns,
  networkRequests,
  files,
  failureDiagnoses,
  failureClusters,
} from '../database/schema';
import type { FailureCluster, FailureDiagnosis } from '../database/schema';
import type { DiagnosisContextCoverage } from '~~/types/api';
import { stripAnsi } from '#shared/error-fingerprint';
import { DIAGNOSIS_SECTIONS } from '#shared/diagnosis-sections';
import { durationStats } from '#shared/utils/stats';
import { computeRegressionContext, normalizeGitUrl } from './regression-context';
import { createScmProvider, detectScmProvider } from './scm';
import { MAX_RAW_DIFF_BYTES } from './scm/ScmProvider';
import type { ScmChanges, ChangedFile } from './scm/ScmProvider';
import type {
  BrowserConfig,
  ConsoleLogEntry,
  RunMetadata,
  ServerLogEntry,
  TestStepInfo,
  WebVitals,
} from './run-json-types';
import { resolveContextLimits } from './ai-context-limits';
import type { ContextLimits } from '#shared/ai-context-limits';
import { getTraceFailingActionSection } from './trace-parser';
import { getLocatorHealing } from './locator-healing';
import type {
  BuildContextOptions,
  DiagnosisScope,
  SectionId,
  ContextSection,
  BuiltDiagnosisContext,
} from './ai-context.types';
import type { AiAttachedImage } from './ai-provider';
import { getStorage } from '../storage';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

type ScmCoverage = NonNullable<DiagnosisContextCoverage['scm']>;

// ── Section wrapping helper ─────────────────────────────────────────────────

function section(
  id: SectionId,
  title: string,
  content: string | null | undefined,
  items?: number,
): ContextSection | null {
  if (!content) return null;
  return {
    id,
    title,
    chars: content.length,
    truncated: content.includes('[truncated]'),
    markdown: content,
    ...(items !== undefined ? { items } : {}),
  };
}

/**
 * Build the "## Data Coverage" block: a compact present/truncated/absent map of
 * the evidence available for this diagnosis, prepended to the AI context so the
 * model can ground its confidence in what it could actually see. The expected
 * section list is shared with the UI via `#shared/diagnosis-sections`.
 */
function buildCoverageBlock(sections: ContextSection[]): string {
  const byId = new Map<string, ContextSection>();
  for (const s of sections) if (!byId.has(s.id)) byId.set(s.id, s);

  const lines = [
    '## Data Coverage',
    'Evidence available for this diagnosis. Absent or truncated sections mean you are working with partial information — calibrate confidenceScore accordingly and do not assert what you could not see.',
    '',
  ];
  for (const { id, label } of DIAGNOSIS_SECTIONS) {
    const s = byId.get(id);
    const state = !s ? 'absent' : s.truncated ? 'present (truncated)' : 'present';
    lines.push(`- [${id}] ${label}: ${state}`);
  }
  return lines.join('\n');
}

// ── SCM diff rendering ──────────────────────────────────────────────────────

/** "- path (status, +A -B)" line for a changed file. */
function formatChangedFileLine(f: ChangedFile): string {
  const stats = f.additions || f.deletions ? `, +${f.additions} -${f.deletions}` : '';
  return `- ${f.filename} (${f.status}${stats})`;
}

/**
 * Render changed-file patches into `--- file\n<patch>` blocks within a shared
 * character budget (mutated across calls so it can span multiple commits).
 * Returns the rendered blocks plus how many files were dropped once the budget
 * was exhausted.
 */
function renderBudgetedPatches(
  files: ChangedFile[],
  budget: { remaining: number },
): { patches: string[]; skipped: number } {
  const patches: string[] = [];
  let skipped = 0;
  for (const f of files) {
    if (!f.patch) continue;
    if (budget.remaining <= 0) {
      skipped++;
      continue;
    }
    const patch =
      f.patch.length > budget.remaining ? f.patch.slice(0, budget.remaining) + '\n[... patch truncated ...]' : f.patch;
    budget.remaining -= Math.min(f.patch.length, budget.remaining);
    patches.push(`--- ${f.filename}\n${patch}`);
  }
  return { patches, skipped };
}

/**
 * Render a "commits + changed files + budgeted patches" section for an SCM diff.
 * Shared by the last-green and manual-baseline paths.
 */
function renderChangedFiles(
  changes: ScmChanges,
  opts: { title: string; budget: number },
): { text: string; patchedFilesCount: number; patchesTruncated: boolean } {
  const lines: string[] = [opts.title];
  if (changes.commits.length > 0) {
    lines.push('Commits:');
    for (const c of changes.commits) lines.push(`- ${c.sha} ${c.message}`);
  }
  lines.push(`\nChanged files (${changes.files.length}):`);
  for (const f of changes.files) lines.push(formatChangedFileLine(f));

  let patchedFilesCount = 0;
  let patchesTruncated = false;
  if (changes.patchesOmitted) {
    lines.push(
      `\n> Note: diff omitted — raw diff exceeded size limit (${Math.round(MAX_RAW_DIFF_BYTES / 1024)} KB). File names and line counts above are complete; no patch content available.`,
    );
  } else {
    const budget = { remaining: opts.budget };
    const { patches, skipped } = renderBudgetedPatches(changes.files, budget);
    if (patches.length > 0) {
      lines.push(`\nPatches:\n\`\`\`diff\n${patches.join('\n\n')}\n\`\`\``);
      patchedFilesCount = patches.length;
      patchesTruncated = skipped > 0;
    }
    if (skipped > 0) {
      lines.push(`\n> Note: ${skipped} file patch${skipped > 1 ? 'es' : ''} omitted (context budget exhausted).`);
    }
  }
  return { text: lines.join('\n'), patchedFilesCount, patchesTruncated };
}

// ── Section builders ────────────────────────────────────────────────────────
// Each returns the markdown for one context section (or null to omit it).

function clusterSummarySection(cluster: FailureCluster): string {
  return `## Failure Cluster
- Signature: ${cluster.signature}
- Error type: ${cluster.errorType ?? 'unknown'}
- Selector: ${cluster.selector ?? 'none'}
- Triage status: ${cluster.status}
- Total occurrences: ${cluster.occurrences}
- First seen run: #${cluster.firstSeenRunId}
- Last seen run: #${cluster.lastSeenRunId}`;
}

function sampleErrorSection(cluster: FailureCluster, limits: ContextLimits): string | null {
  if (!cluster.sampleError) return null;
  const clean = stripAnsi(cluster.sampleError);
  const truncated = clean.slice(0, limits.sampleErrorChars);
  return `## Sample Raw Error\n\`\`\`\n${truncated}${clean.length > limits.sampleErrorChars ? '\n[truncated]' : ''}\n\`\`\``;
}

async function affectedTestsSection(
  db: DbClient,
  cluster: FailureCluster,
  limits: ContextLimits,
): Promise<string | null> {
  const affectedRows = await db
    .select({
      title: testCases.title,
      filePath: testCases.filePath,
      line: sql<number | null>`MAX(${testRunsCases.line})`,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.failureClusterId, cluster.id))
    .groupBy(testCases.id)
    .limit(limits.affectedTests + 1);

  if (affectedRows.length === 0) return null;

  const shown = affectedRows.slice(0, limits.affectedTests);
  const extra =
    affectedRows.length > limits.affectedTests ? `\n…and ${affectedRows.length - limits.affectedTests} more` : '';
  return `## Affected Tests\n${shown.map((t) => `- ${t.title} (${t.filePath}${t.line ? `:${t.line}` : ''})`).join('\n')}${extra}`;
}

async function browserDistributionSection(db: DbClient, cluster: FailureCluster): Promise<string | null> {
  const browserRows = await db
    .select({
      browser: testRunsCases.browser,
      count: sql<number>`COUNT(*)`,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, cluster.id))
    .groupBy(testRunsCases.browser);

  if (browserRows.length === 0) return null;

  const browserSummary = browserRows
    .map((r) => {
      const b = r.browser as BrowserConfig | null;
      const name = [b?.projectName, b?.browserName].filter(Boolean).join(' / ') || 'unknown';
      return `- ${name}: ${r.count} failure${r.count === 1 ? '' : 's'}`;
    })
    .join('\n');
  return `## Browser Distribution\n${browserSummary}`;
}

/** Latest run-case for this cluster, with its test info + run metadata — the diagnosis's main evidence. */
async function loadRepresentativeExecution(db: DbClient, cluster: FailureCluster) {
  const repRows = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      error: testRunsCases.error,
      browser: testRunsCases.browser,
      retries: testRunsCases.retries,
      duration: testRunsCases.duration,
      line: testRunsCases.line,
      column: testRunsCases.column,
      steps: testRunsCases.steps,
      consoleLogs: testRunsCases.consoleLogs,
      ariaSnapshot: testRunsCases.ariaSnapshot,
      testSource: testRunsCases.testSource,
      webVitals: testRunsCases.webVitals,
      testAnnotations: testRunsCases.testAnnotations,
      workerIndex: testRunsCases.workerIndex,
      shardIndex: testRunsCases.shardIndex,
      testCaseId: testRunsCases.testCaseId,
      browserName: testRunsCases.browserName,
      testTitle: testCases.title,
      testFilePath: testCases.filePath,
      testSuitePath: testCases.suitePath,
      flakyRootCause: testCases.flakyRootCause,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.failureClusterId, cluster.id))
    .orderBy(desc(testRunsCases.id))
    .limit(1);

  const rep = repRows[0] ?? null;
  if (!rep) return null;

  const [runRow, nrRows] = await Promise.all([
    db
      .select({
        environment: testRuns.environment,
        metadata: testRuns.metadata,
        isFullRun: testRuns.isFullRun,
        filterDetails: testRuns.filterDetails,
      })
      .from(testRuns)
      .where(eq(testRuns.id, rep.testRunId))
      .limit(1),
    db.select().from(networkRequests).where(eq(networkRequests.testRunsCaseId, rep.id)),
  ]);

  const run = runRow[0] ?? null;

  return {
    ...rep,
    nrItems: nrRows,
    runEnvironment: run?.environment ?? null,
    runMetadata: (run?.metadata as RunMetadata | null) ?? null,
    runIsFullRun: run?.isFullRun ?? null,
    runFilterDetails: (run?.filterDetails as { grep?: string; grepInvert?: string } | null) ?? null,
  };
}

type RepresentativeRow = NonNullable<Awaited<ReturnType<typeof loadRepresentativeExecution>>>;

/** Build a CI/run header string from the representative execution's run metadata (D4). */
function ciRunHeaderLines(rep: RepresentativeRow): string[] {
  const lines: string[] = [];
  const meta = rep.runMetadata as RunMetadata | null;
  const env = rep.runEnvironment as Record<string, string> | null;

  if (meta?.scm?.commit) {
    const short = meta.scm.commit.slice(0, 7);
    lines.push(`- Commit: ${short}`);
  }
  if (meta?.scm?.branch) lines.push(`- Branch: ${meta.scm.branch}`);
  if (meta?.ci?.provider) lines.push(`- CI: ${meta.ci.provider}`);
  if (env?.workerIndex != null) lines.push(`- Worker: ${env.workerIndex}`);
  if (env?.os) lines.push(`- OS: ${env.os}`);
  if (env?.hostname) lines.push(`- Hostname: ${env.hostname}`);
  return lines;
}

/** Extract steps that have an error attached (D6). */
function failingStepsSection(rep: RepresentativeRow, limits: ContextLimits): string | null {
  const steps = (rep.steps as (TestStepInfo & { error?: { message?: string } })[] | null) ?? [];
  const failing = steps.filter((s) => s.error?.message);
  if (failing.length === 0) return null;
  const out = failing.map(
    (s) =>
      `- [${s.category ?? 'step'}] ${s.title}\n\`\`\`\n${s.error!.message!.slice(0, limits.sampleErrorChars)}\n\`\`\``,
  );
  return `### Failed Steps\n${out.join('\n')}`;
}

/** Runtime test annotations (@fixme/@flaky/@slow …) declared on the test. */
function testAnnotationsSection(rep: RepresentativeRow): string | null {
  const ann = rep.testAnnotations as Array<{ type?: string; description?: string }> | null;
  if (!ann || ann.length === 0) return null;
  const lines = ann.filter((a) => a?.type).map((a) => `- @${a.type}${a.description ? `: ${a.description}` : ''}`);
  if (lines.length === 0) return null;
  return `## Test Annotations\nMarks declared on the test — treat known @fixme/@flaky/@skip as established context, not new findings:\n${lines.join('\n')}`;
}

/**
 * Run-level context that shapes interpretation: partial/filtered run, parallel
 * worker/shard (race hint), describe-block path, and any pre-classified flaky
 * root cause. All from data already stored — no extra collection.
 */
function runContextSection(rep: RepresentativeRow): string | null {
  const lines: string[] = [];

  if (rep.runIsFullRun === 0) {
    const fd = rep.runFilterDetails;
    const filt = fd?.grep ? ` (grep: ${fd.grep})` : fd?.grepInvert ? ` (grepInvert: ${fd.grepInvert})` : '';
    lines.push(
      `- Partial/filtered run${filt} — not the full suite; missing peers may be due to filtering, not passing`,
    );
  }

  const sp = rep.testSuitePath;
  if (sp) lines.push(`- Describe path: ${sp.split('').join(' › ')}`);

  if (rep.workerIndex != null) {
    const shard = rep.shardIndex != null ? `, shard ${rep.shardIndex}` : '';
    lines.push(
      `- Parallel worker #${rep.workerIndex}${shard} — consider a race if peers on the same worker also failed`,
    );
  }

  if (rep.flakyRootCause) {
    lines.push(`- Pre-classified flaky root cause (heuristic): ${rep.flakyRootCause}`);
  }

  if (lines.length === 0) return null;
  return `## Run Context\n${lines.join('\n')}`;
}

function countConsoleErrors(logs: ConsoleLogEntry[] | null): number {
  if (!Array.isArray(logs)) return 0;
  return logs.filter((l) => l?.type === 'error').length;
}

function relativeDays(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/** Failing-vs-passing deltas for the web vitals we collect. */
function compareVitals(fail: WebVitals | null, pass: WebVitals | null): string[] {
  if (!fail || !pass) return [];
  const pairs: Array<[string, number | null | undefined, number | null | undefined]> = [
    ['LCP', fail.paint?.LCP, pass.paint?.LCP],
    ['FCP', fail.paint?.FCP, pass.paint?.FCP],
    ['DOMContentLoaded', fail.navigation?.domContentLoaded, pass.navigation?.domContentLoaded],
  ];
  const out: string[] = [];
  for (const [name, f, p] of pairs) {
    if (typeof f === 'number' && typeof p === 'number') {
      const delta = Math.round(f - p);
      out.push(
        `- ${name}: failing ${Math.round(f)}ms vs passing ${Math.round(p)}ms (${delta >= 0 ? '+' : ''}${delta}ms)`,
      );
    }
  }
  return out;
}

/**
 * Compare the failing execution to the same test's recent passing runs:
 * duration vs baseline, web-vitals deltas, console-error delta, how far the
 * run got (steps executed), and whether the last pass is newer than the
 * cluster's last seen (already-green reconciliation).
 * All from data already stored — no extra collection.
 */
async function baselineComparisonSection(
  db: DbClient,
  rep: RepresentativeRow,
  clusterLastSeenRunId?: number,
): Promise<{ section: string | null; alreadyGreen: boolean }> {
  if (rep.testCaseId == null) return { section: null, alreadyGreen: false };

  const passings = await db
    .select({
      duration: testRunsCases.duration,
      webVitals: testRunsCases.webVitals,
      consoleLogs: testRunsCases.consoleLogs,
      steps: testRunsCases.steps,
      runId: testRunsCases.testRunId,
      startTime: testRuns.startTime,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(eq(testRunsCases.testCaseId, rep.testCaseId), eq(testRunsCases.status, 'passed')))
    .orderBy(desc(testRuns.startTime))
    .limit(20);

  if (passings.length === 0) return { section: null, alreadyGreen: false };

  const last = passings[0]!;
  const lines: string[] = [];

  // Check if the last passing run is NEWER than the cluster's lastSeen run
  let alreadyGreen = false;
  if (clusterLastSeenRunId != null && last.runId > clusterLastSeenRunId) {
    alreadyGreen = true;
    const when = last.startTime instanceof Date ? relativeDays(last.startTime) : null;
    lines.push(
      `⚠️ This test has PASSED on a newer commit (run #${last.runId} > failing #${clusterLastSeenRunId}). The cluster may already be resolved; diagnose the historical failure, or re-triage as fixed.`,
    );
    if (when) lines.push(`- Last passing run: #${last.runId} (${when})`);
  }

  const when = last.startTime instanceof Date ? relativeDays(last.startTime) : null;
  if (!alreadyGreen) {
    lines.push(`- Last passed: run #${last.runId}${when ? ` (${when})` : ''}`);
  }

  const stats = durationStats(passings.map((p) => p.duration));
  if (stats && rep.duration != null) {
    const ratio = stats.avg > 0 ? rep.duration / stats.avg : 0;
    const ratioStr = ratio >= 1.5 ? ` — ${ratio.toFixed(1)}× the passing average` : '';
    lines.push(`- Duration: failing ${rep.duration}ms vs passing avg ${stats.avg}ms / p90 ${stats.p90}ms${ratioStr}`);
  }

  lines.push(...compareVitals(rep.webVitals as WebVitals | null, last.webVitals as WebVitals | null));

  const failErrors = countConsoleErrors(rep.consoleLogs as ConsoleLogEntry[] | null);
  const passErrors = countConsoleErrors(last.consoleLogs as ConsoleLogEntry[] | null);
  if (failErrors !== passErrors) {
    lines.push(`- Console errors: ${failErrors} in the failing run vs ${passErrors} when it last passed`);
  }

  const failSteps = Array.isArray(rep.steps) ? rep.steps.length : null;
  const passSteps = Array.isArray(last.steps) ? last.steps.length : null;
  if (failSteps != null && passSteps != null && failSteps < passSteps) {
    lines.push(`- Steps executed: ${failSteps} (stopped early) vs ${passSteps} when passing`);
  }

  if (lines.length === 0) return { section: null, alreadyGreen };
  return {
    section: `## Compared to Last Pass\nSame test, failing execution vs its recent passing runs:\n${lines.join('\n')}`,
    alreadyGreen,
  };
}

/**
 * Per-attempt error progression for the failing test in its run. Each retry is
 * already stored as its own row (dedup key includes `retries`), so this needs no
 * extra collection. The progression discriminates a deterministic bug (same
 * error every attempt) from flakiness (passes on retry) or a race (differing
 * errors).
 */
async function retryProgressionSection(db: DbClient, rep: RepresentativeRow): Promise<string | null> {
  if (rep.testCaseId == null) return null;

  const conds = [eq(testRunsCases.testRunId, rep.testRunId), eq(testRunsCases.testCaseId, rep.testCaseId)];
  if (rep.browserName) conds.push(eq(testRunsCases.browserName, rep.browserName));

  const attempts = await db
    .select({ retries: testRunsCases.retries, status: testRunsCases.status, error: testRunsCases.error })
    .from(testRunsCases)
    .where(and(...conds))
    .orderBy(testRunsCases.retries);

  if (attempts.length <= 1) return null;

  const firstLine = (e: string | null) =>
    e
      ? (stripAnsi(e)
          .split('\n')
          .find((l) => l.trim()) ?? '')
      : '';
  const lines = attempts.map((a) => {
    const head = a.error ? firstLine(a.error).slice(0, 200) : '(no error)';
    return `- Attempt ${a.retries ?? 0} — ${a.status}: ${head}`;
  });

  const failHeads = attempts.filter((a) => a.error).map((a) => firstLine(a.error));
  const passed = attempts.some((a) => a.status === 'passed');
  const allSameError = failHeads.length > 1 && failHeads.every((h) => h === failHeads[0]);
  let insight: string;
  if (passed) {
    insight = `The test passed on retry — an intermittent/flaky failure${allSameError ? ' (the same error on each failing attempt)' : ''}.`;
  } else if (allSameError) {
    insight = 'Every attempt failed with the same error — points to a deterministic bug, not flakiness.';
  } else {
    insight = 'Attempts failed with differing errors — suggests an unstable environment or a race condition.';
  }
  return `## Retry Progression\n${insight}\n${lines.join('\n')}`;
}

/** Tests in the same file that passed in the representative execution's run (D5). */
async function passedPeersSection(
  db: DbClient,
  rep: RepresentativeRow,
  limits: ContextLimits,
): Promise<{ section: string | null; notApplicableReason: string | null }> {
  const testFilePath = rep.testFilePath;
  if (!testFilePath) return { section: null, notApplicableReason: null };

  // Detect serial mode — check if any test in the same file was skipped
  const suiteInfo = rep.testSuitePath as string | null;
  const serialMode = suiteInfo?.includes('serial') ?? false;

  if (serialMode) {
    // Check if peers exist but were skipped (serial mode — one failure skips the rest)
    const skippedPeers = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(
        and(
          eq(testRunsCases.testRunId, rep.testRunId),
          eq(testRunsCases.status, 'skipped'),
          eq(testCases.filePath, testFilePath),
        ),
      )
      .limit(1);

    if (skippedPeers.length > 0) {
      return {
        section: null,
        notApplicableReason: 'peers skipped (serial mode) — not a signal',
      };
    }
  }

  const peers = await db
    .select({ title: testCases.title })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(
      and(
        eq(testRunsCases.testRunId, rep.testRunId),
        eq(testRunsCases.status, 'passed'),
        eq(testCases.filePath, testFilePath),
      ),
    )
    .limit(limits.maxPassedPeers + 1);

  if (peers.length === 0) return { section: null, notApplicableReason: null };
  const shown = peers.slice(0, limits.maxPassedPeers);
  const extra = peers.length > limits.maxPassedPeers ? `\n…and ${peers.length - limits.maxPassedPeers} more` : '';
  return {
    section: `## Passed Peers\n${shown.map((t) => `- ${t.title}`).join('\n')}${extra}`,
    notApplicableReason: null,
  };
}

/** Trace file URLs for the representative execution (D12). */
async function tracePointersSection(db: DbClient, rep: RepresentativeRow): Promise<string | null> {
  const traceFiles = await db
    .select({ path: files.path, label: files.label })
    .from(files)
    .where(and(eq(files.testRunsCaseId, rep.id), eq(files.type, 'trace')))
    .limit(5);
  if (traceFiles.length === 0) return null;
  const lines = traceFiles.map((f) => `- ${f.label || 'Trace'}: /api/files/${f.path}`);
  return `## Trace Files\n${lines.join('\n')}`;
}

/** Parse the Playwright trace ZIP for the failing action context (B1). */
async function failingActionSection(
  db: DbClient,
  rep: RepresentativeRow,
  limits: ContextLimits,
): Promise<string | null> {
  if (limits.maxTraceActions <= 0) return null;

  const traceFiles = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.testRunsCaseId, rep.id), eq(files.type, 'trace')))
    .limit(1);

  if (traceFiles.length === 0) return null;
  const blobPath = traceFiles[0]!.path;
  if (!blobPath) return null;

  return getTraceFailingActionSection(db, blobPath, limits);
}

function formatFileSize(n: number | null): string {
  if (n == null) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

/**
 * Pointers to the execution's captured artifacts (video, HAR, custom
 * attachments). Already uploaded — surfaced as links so the diagnosis knows they
 * exist and a human can inspect them. Not inlined (videos/HAR can be large).
 */
async function artifactsSection(db: DbClient, rep: RepresentativeRow): Promise<string | null> {
  const rows = await db
    .select({ subtype: files.subtype, label: files.label, path: files.path, size: files.size })
    .from(files)
    .where(and(eq(files.testRunsCaseId, rep.id), eq(files.type, 'attachment')))
    .limit(15);
  if (rows.length === 0) return null;
  const lines = rows.map((f) => {
    const name = f.subtype || 'attachment';
    const ct = f.label ? ` (${f.label})` : '';
    const sz = f.size != null ? ` — ${formatFileSize(f.size)}` : '';
    return `- ${name}${ct}${sz}: /api/files/${f.path}`;
  });
  return `## Attachments & Artifacts\nFiles captured for this execution (video, HAR, custom artifacts) — available for inspection, not inlined:\n${lines.join('\n')}`;
}

/** Auto-resolve screenshots for the representative execution (D1). */
async function resolveScreenshots(
  db: DbClient,
  rep: RepresentativeRow,
  limits: ContextLimits,
): Promise<AiAttachedImage[]> {
  if (limits.maxImages <= 0) return [];
  const screenshotRows = await db
    .select({ path: files.path, label: files.label })
    .from(files)
    .where(and(eq(files.testRunsCaseId, rep.id), eq(files.type, 'screenshot')))
    .limit(limits.maxImages);

  if (screenshotRows.length === 0) return [];

  const storage = getStorage();
  const images: AiAttachedImage[] = [];

  for (const f of screenshotRows) {
    if (images.length >= limits.maxImages) break;
    try {
      const buf = await storage.readFile(f.path);
      const ext = f.path.toLowerCase().split('.').pop() || 'png';
      const mediaType =
        ext === 'jpg' || ext === 'jpeg'
          ? ('image/jpeg' as const)
          : ext === 'gif'
            ? ('image/gif' as const)
            : ext === 'webp'
              ? ('image/webp' as const)
              : ('image/png' as const);
      images.push({
        name: f.label || f.path.split('/').pop() || 'screenshot',
        mediaType,
        data: buf.toString('base64'),
      });
    } catch {
      // skip inaccessible files
    }
  }

  return images;
}

/** Recurrence pattern + flakiness analysis for the cluster (D2/D3). */
async function recurrenceFlakinessSection(
  db: DbClient,
  cluster: FailureCluster,
  limits: ContextLimits,
): Promise<string | null> {
  const recentRuns = await db
    .select({
      runId: testRunsCases.testRunId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
    })
    .from(testRunsCases)
    .where(
      and(
        eq(testRunsCases.failureClusterId, cluster.id),
        inArray(
          testRunsCases.testRunId,
          db
            .select({ id: testRuns.id })
            .from(testRuns)
            .where(eq(testRuns.projectId, cluster.projectId))
            .orderBy(desc(testRuns.startTime))
            .limit(30),
        ),
      ),
    );

  if (recentRuns.length === 0) return null;

  // Group by run
  const byRun = new Map<number, { total: number; failed: number; retried: number; passOnRetry: boolean }>();
  for (const r of recentRuns) {
    let g = byRun.get(r.runId);
    if (!g) {
      g = { total: 0, failed: 0, retried: 0, passOnRetry: false };
      byRun.set(r.runId, g);
    }
    g.total++;
    if (r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted') g.failed++;
    if ((r.retries ?? 0) > 0) g.retried++;
    if ((r.retries ?? 0) > 0 && r.status === 'passed') g.passOnRetry = true;
  }

  const affectedRuns = byRun.size;
  let retryPassCount = 0;
  for (const g of byRun.values()) if (g.passOnRetry) retryPassCount++;

  const pattern =
    retryPassCount > 0 && retryPassCount >= affectedRuns / 3
      ? 'intermittent'
      : retryPassCount === 0 && affectedRuns > 1
        ? 'persistent'
        : 'unknown';

  const lines: string[] = ['## Recurrence & Flakiness'];
  lines.push(`- Affected runs: ${affectedRuns}, total occurrences: ${recentRuns.length}`);
  lines.push(`- Retry-passes: ${retryPassCount} of ${affectedRuns} runs`);
  lines.push(
    `- Pattern: ${pattern}${pattern === 'intermittent' ? ' — affects some runs, some pass on retry' : pattern === 'persistent' ? ' — every run affected' : ''}`,
  );

  // Per-run breakdown (compact)
  const runBreakdown: string[] = [];
  for (const [runId, g] of byRun) {
    const passOnRetry = g.passOnRetry ? ' (pass-on-retry)' : '';
    runBreakdown.push(`  - run #${runId}: ${g.total} case(s), ${g.failed} failed, ${g.retried} retried${passOnRetry}`);
  }
  if (runBreakdown.length > 20) {
    lines.push('Recent runs:');
    lines.push(...runBreakdown.slice(0, 20));
    lines.push(`  …and ${runBreakdown.length - 20} more`);
  } else if (runBreakdown.length > 0) {
    lines.push('Recent runs:');
    lines.push(...runBreakdown);
  }

  return lines.join('\n');
}

/** Prior diagnosis + triage note feedback (D10). */
async function priorDiagnosisSection(db: DbClient, cluster: FailureCluster): Promise<string | null> {
  const prev = await db
    .select({
      status: failureDiagnoses.status,
      category: failureDiagnoses.category,
      confidence: failureDiagnoses.confidence,
      summary: failureDiagnoses.summary,
      rootCause: failureDiagnoses.rootCause,
    })
    .from(failureDiagnoses)
    .where(eq(failureDiagnoses.clusterId, cluster.id))
    .limit(1);

  const d = prev[0];
  if (!d || d.status !== 'completed') return null;

  const lines: string[] = ['## Prior Assessment (from last diagnosis)'];
  if (d.category) lines.push(`- Previous category: ${d.category}`);
  if (d.confidence) lines.push(`- Previous confidence: ${d.confidence}`);
  if (d.summary) lines.push(`- Previous summary: ${d.summary}`);
  if (d.rootCause) lines.push(`- Previous root cause: ${d.rootCause}`);

  if (cluster.triageNote) {
    lines.push(`- Triage note: ${cluster.triageNote}`);
  }

  lines.push('');
  lines.push('> The user is re-diagnosing. Either reaffirm this assessment with new evidence or revise it.');

  return lines.join('\n');
}

// ── Content-aware ARIA snapshot truncation ───────────────────────────────────

interface AriaBlock {
  startLine: number;
  endLine: number;
  role: string;
  name: string;
  charCount: number;
  isContent: boolean;
}

/**
 * Content-aware ARIA snapshot truncation: prioritizes the content region
 * (`main`, else the largest non-nav `document`/`region` subtree) and
 * gives repetitive landmarks (`navigation`/`list` with many siblings) a
 * small fixed budget, collapsing the remainder. Always keeps at least the
 * role headers of dropped regions so the model knows they existed.
 */
function selectAriaForBudget(snapshot: string, budget: number): string {
  if (snapshot.length <= budget) return snapshot;

  const lines = snapshot.split('\n');

  // Identify top-level blocks (lines starting with `- ` at indent 0)
  const blocks: AriaBlock[] = [];
  let blockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (indent === 0 && trimmed.startsWith('- ')) {
      if (blockStart >= 0) {
        blocks.push(extractBlock(lines, blockStart, i - 1));
      }
      blockStart = i;
    }
  }
  if (blockStart >= 0) {
    blocks.push(extractBlock(lines, blockStart, lines.length - 1));
  }

  if (blocks.length === 0) {
    return snapshot.slice(0, budget);
  }

  // Classify blocks
  for (const block of blocks) {
    const firstLine = lines[block.startLine] ?? '';
    const roleMatch = firstLine.match(/\[role=(\w+)\]/) || firstLine.match(/^-\s*(\w+)(?=\s|["])/);
    block.role = roleMatch ? (roleMatch[1] ?? '').toLowerCase() : '';
    block.charCount = lines.slice(block.startLine, block.endLine + 1).join('\n').length;
    block.isContent = block.role === 'main' || (block.role === 'region' && !block.role.includes('nav'));
  }

  // Find content block and nav/list blocks
  const contentBlock = blocks.find((b) => b.isContent) || blocks.reduce((a, b) => (a.charCount >= b.charCount ? a : b));
  const navBlocks = blocks.filter((b) => b.role === 'navigation' || b.role === 'list');

  // Budget allocation: content gets 70%, nav gets a shared 20%, rest 10%
  const contentBudget = Math.floor(budget * 0.7);
  const navBudget = Math.floor(budget * 0.2);
  const otherBudget = budget - contentBudget - navBudget;

  const resultLines: string[] = [];
  let remaining = budget;

  for (const block of blocks) {
    const blockText = lines.slice(block.startLine, block.endLine + 1).join('\n');
    let lineBudget: number;

    if (block === contentBlock) {
      lineBudget = contentBudget;
    } else if (navBlocks.includes(block)) {
      lineBudget = Math.floor(navBudget / navBlocks.length);
    } else {
      lineBudget = Math.floor(otherBudget / (blocks.length - 1 - navBlocks.length) || otherBudget);
    }

    if (blockText.length <= lineBudget) {
      resultLines.push(blockText);
      remaining -= blockText.length;
    } else {
      // Collapse the block: keep header + collapse long sibling runs
      const collapsed = collapseAriaBlock(lines, block, Math.max(lineBudget, 80));
      resultLines.push(collapsed);
      remaining -= collapsed.length;
    }
  }

  const result = resultLines.join('\n');
  return result.length <= budget ? result : result.slice(0, budget) + '\n[truncated]';
}

function extractBlock(lines: string[], start: number, end: number): AriaBlock {
  const firstLine = lines[start] ?? '';
  const nameMatch = firstLine.match(/"([^"]+)"/);
  return {
    startLine: start,
    endLine: end,
    role: '',
    name: nameMatch ? (nameMatch[1] ?? '') : '',
    charCount: 0,
    isContent: false,
  };
}

/**
 * Collapse an ARIA block: keep the header line, then condense long sibling
 * runs (listitems, links) to first K + elision marker.
 */
function collapseAriaBlock(lines: string[], block: AriaBlock, budget: number): string {
  const headerLine = lines[block.startLine] ?? '';
  const childLines = lines.slice(block.startLine + 1, block.endLine + 1);

  // Count sibling groups by indentation
  const indentCounts = new Map<number, number>();
  let prevIndent = -1;
  let sameIndentCount = 0;
  let maxIndent = 0;
  for (const l of childLines) {
    const trimmed = l.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = l.length - trimmed.length;
    if (indent > maxIndent) maxIndent = indent;
    if (indent === prevIndent) {
      sameIndentCount++;
    } else {
      if (sameIndentCount > 5) {
        indentCounts.set(prevIndent, Math.max(indentCounts.get(prevIndent) ?? 0, sameIndentCount));
      }
      sameIndentCount = 1;
      prevIndent = indent;
    }
  }
  if (sameIndentCount > 5) {
    indentCounts.set(prevIndent, Math.max(indentCounts.get(prevIndent) ?? 0, sameIndentCount));
  }

  // Collapse: keep header + first few items per deep indent level, elide rest
  const collapsed: string[] = [headerLine];
  const seenPerIndent = new Map<number, number>();
  const keptLines: string[] = [];

  // Determine the deepest indent level with many siblings
  const problemIndent = maxIndent;

  for (const l of childLines) {
    const trimmed = l.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = l.length - trimmed.length;

    if (indent === problemIndent && (indentCounts.get(indent) ?? 0) > 5) {
      const seen = seenPerIndent.get(indent) ?? 0;
      if (seen >= 3) {
        // Skip this line; we'll add one elision marker
        continue;
      }
      seenPerIndent.set(indent, seen + 1);
      keptLines.push(l);
    } else {
      keptLines.push(l);
    }
  }

  collapsed.push(...keptLines);

  // If we collapsed any, add elision
  const totalAtProblemIndent = childLines.filter((l) => {
    const t = l.trimStart();
    return l.length - l.trimStart().length === problemIndent && t && !t.startsWith('#');
  }).length;
  const keptAtProblemIndent = keptLines.filter((l) => l.length - l.trimStart().length === problemIndent).length;
  if (keptAtProblemIndent < totalAtProblemIndent) {
    collapsed.push(
      `  ${'  '.repeat(problemIndent > 0 ? Math.floor(problemIndent / 2) : 0)}- … (${totalAtProblemIndent - keptAtProblemIndent} more items elided)`,
    );
  }

  let result = collapsed.join('\n');
  if (result.length > budget) {
    result = result.slice(0, budget) + '\n[truncated]';
  }
  return result;
}

/** Parse a `getByRole`-style locator from an error message. */
function parseLocatorFromError(
  error: string,
): { role?: string; name?: string; exact?: boolean; method?: string } | null {
  // Match: getByRole('heading', { name: 'Users', exact: true })
  const roleMatch = error.match(/getByRole\(\s*'(\w+)'\s*(?:,\s*\{[^}]*name:\s*'([^']*)'([^}]*)\})?\s*\)/);
  if (roleMatch) {
    const exact = roleMatch[3]?.includes('exact: true') || false;
    return { role: roleMatch[1], name: roleMatch[2], exact, method: 'getByRole' };
  }
  // Match: getByText('some text')
  const textMatch = error.match(/getBy(Text|Label|Placeholder|Title|AltText)\(\s*['"]([^'"]+)['"]\s*\)/);
  if (textMatch) {
    return { method: textMatch[1]!, name: textMatch[2], exact: false };
  }
  return null;
}

/** Parse ARIA snapshot YAML lines into {role, name} pairs. */
function parseAriaEntries(snapshot: string): Array<{ role: string; name: string }> {
  const entries: Array<{ role: string; name: string }> = [];
  for (const line of snapshot.split('\n')) {
    const roleMatch = line.match(/\[role=(\w+)\]/);
    if (!roleMatch) continue;
    const nameMatch = line.match(/"([^"]+)"/);
    entries.push({ role: (roleMatch[1] ?? '').toLowerCase(), name: nameMatch ? (nameMatch[1] ?? '') : '' });
  }
  return entries;
}

/** Simple token-overlap similarity between two strings (0–1). */
function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(a.toLowerCase().split(/\s+/));
  const bTokens = b.toLowerCase().split(/\s+/);
  if (aTokens.size === 0 && bTokens.length === 0) return 1;
  let overlap = 0;
  for (const t of bTokens) if (aTokens.has(t)) overlap++;
  return overlap / Math.max(aTokens.size, bTokens.length);
}

/**
 * Nearest accessible-name hint for locator failures.
 * When the failing error contains a role/name locator, parse the stored ARIA
 * snapshot and surface the closest candidates.
 */
function nearestAriaNamesSection(rep: RepresentativeRow): string | null {
  if (!rep.error && !rep.ariaSnapshot) return null;
  const error = rep.error?.trim() || '';
  const snapshot = rep.ariaSnapshot?.trim() || '';
  if (!error || !snapshot) return null;

  const locator = parseLocatorFromError(error);
  if (!locator) return null;

  const entries = parseAriaEntries(snapshot);
  if (entries.length === 0) return null;

  // Filter entries matching the locator's role
  const sameRole = locator.role ? entries.filter((e) => e.role === locator.role) : entries;

  if (sameRole.length === 0 || !locator.name) return null;

  // Score by token similarity
  const scored = sameRole.map((e) => ({
    ...e,
    score: tokenSimilarity(locator.name!, e.name),
  }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 5).filter((e) => e.score > 0 || e.name);
  if (top.length === 0) return null;

  const lines: string[] = ['### Nearest matching elements (from ARIA)'];
  lines.push(
    `Requested: ${locator.method}('${locator.role ?? ''}', name="${locator.name}"${locator.exact ? ', exact: true' : ''})`,
  );
  for (const e of top) {
    const note =
      e.score >= 1
        ? ''
        : e.score > 0.3
          ? ` — close match (score: ${e.score.toFixed(2)})`
          : ` — partial match (score: ${e.score.toFixed(2)})`;
    const exactHint = locator.exact && e.name !== locator.name ? ' — exact:false would match' : '';
    lines.push(`Present:   ${e.role} "${e.name}"${exactHint}${note}`);
  }

  return lines.join('\n');
}

/**
 * Alternative locators for the failing action, sourced from prior passing runs
 * (highest confidence — captured against the real DOM) or the current ARIA
 * snapshot. Surfaces pre-validated locator suggestions so the model can
 * recommend a concrete, grounded fix instead of fabricating a locator.
 *
 * Returns the section text plus structured coverage for the UI status line.
 */
async function locatorHealingSection(
  db: DbClient,
  rep: RepresentativeRow,
): Promise<{
  section: string | null;
  coverage: NonNullable<DiagnosisContextCoverage['locatorHealing']> | null;
}> {
  if (!rep.error) return { section: null, coverage: null };

  const healing = await getLocatorHealing(db, rep.id);
  const alternatives = healing.fromPriorSuccess ?? healing.fromAriaSnapshot ?? [];

  if (alternatives.length === 0) {
    // No alternatives — only report coverage when we actually recognized a
    // failing locator (so the UI can show "none found" rather than "n/a").
    return {
      section: null,
      coverage: healing.failingLocator ? { source: healing.source, alternativesCount: 0 } : null,
    };
  }

  const lines: string[] = ['## Alternative Locators (Locator Healing)'];
  if (healing.failingLocator) {
    const argsStr = Object.entries(healing.failingLocator.args)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');
    lines.push(`Failing locator: ${healing.failingLocator.method}(${argsStr})`);
  }
  const sourceLabel =
    healing.source === 'prior-run'
      ? 'captured against the real DOM in a prior passing run'
      : healing.source === 'fingerprint'
        ? 'matched by locator fingerprint from a prior passing run'
        : 'derived from the current ARIA snapshot';
  lines.push(`Source: ${healing.source} (${sourceLabel})`);

  // Surface the single convention-preserving recommendation so the model picks
  // the same minimal, idiomatic fix the dashboard highlights — not just the
  // highest-stability locator regardless of the developer's original style.
  const rec = healing.recommendation;
  if (rec?.recommended) {
    const style = rec.preservesConvention
      ? 'keeps the original locator style — a minimal, idiomatic edit'
      : 'the most stable available (the original style had no stable alternative)';
    lines.push('');
    lines.push(
      `Recommended fix (use in suggestedFix.code): \`${rec.recommended.locator}\` (score ${rec.recommended.score}) — ${style}.`,
    );
    if (rec.hasDurableAlternative && rec.durable) {
      lines.push(
        `Sturdier alternative if a different locator style is acceptable: \`${rec.durable.locator}\` (score ${rec.durable.score}).`,
      );
    }
    if (rec.suggestAddTestId) {
      lines.push(
        'All alternatives score below 50 — recommend adding a stable data-testid attribute to this element in the application as the durable fix.',
      );
    }
    lines.push('');
  }

  lines.push('Top alternatives, ranked by stability score:');
  for (const alt of alternatives.slice(0, 5)) {
    lines.push(`- \`${alt.locator}\` (score ${alt.score})`);
  }

  return {
    section: lines.join('\n'),
    coverage: { source: healing.source, alternativesCount: alternatives.length },
  };
}

/** Header + error/source/steps/console/network/web-vitals/ARIA sub-sections from one execution. */
function representativeExecutionSections(
  rep: RepresentativeRow,
  cluster: FailureCluster,
  limits: ContextLimits,
): string[] {
  const out: string[] = [];

  const browser = rep.browser as BrowserConfig | null;
  const browserStr = [browser?.projectName, browser?.browserName].filter(Boolean).join(' / ');
  const location = rep.line ? `${rep.testFilePath}:${rep.line}${rep.column ? `:${rep.column}` : ''}` : rep.testFilePath;

  const headerLines: string[] = [
    `## Representative Execution (run #${rep.testRunId})`,
    `- Test: ${rep.testTitle}`,
    `- Location: ${location}`,
    `- Browser: ${browserStr || 'unknown'}`,
    `- Retries: ${rep.retries ?? 0}`,
    `- Duration: ${rep.duration != null ? `${rep.duration}ms` : 'unknown'}`,
  ];

  // D4: CI/env/OS metadata
  headerLines.push(...ciRunHeaderLines(rep));

  out.push(headerLines.join('\n'));

  // Direct error from this execution (may be more detailed than cluster sampleError)
  if (rep.error && rep.error !== cluster.sampleError) {
    const clean = stripAnsi(rep.error);
    const truncated = clean.slice(0, limits.sampleErrorChars);
    out.push(
      `### Execution Error\n\`\`\`\n${truncated}${clean.length > limits.sampleErrorChars ? '\n[truncated]' : ''}\n\`\`\``,
    );
  }

  // D7: Test source — keep failing test body full, truncate surrounding
  if (rep.testSource) {
    let source = rep.testSource;
    const isTruncated = source.length > limits.testSourceChars;
    // Heuristic: try to keep the test block anchored by "test(" or "it("
    if (isTruncated) {
      const testPattern = /^\s*(test|it)\s*\(/m;
      const testMatch = source.match(testPattern);
      if (testMatch && testMatch.index !== undefined) {
        const fromTest = source.slice(testMatch.index);
        if (fromTest.length <= limits.testSourceChars) {
          source = fromTest;
        } else {
          source = source.slice(0, limits.testSourceChars);
        }
      } else {
        source = source.slice(0, limits.testSourceChars);
      }
    }
    out.push(`### Test Source\n\`\`\`typescript\n${source}${isTruncated ? '\n[truncated]' : ''}\n\`\`\``);
  }

  // Steps
  const steps = (rep.steps as TestStepInfo[] | null) ?? [];
  if (steps.length > 0) {
    const shown = steps.slice(-limits.steps);
    out.push(
      `### Steps (last ${shown.length})\n${shown.map((s) => `- [${s.category ?? 'step'}] ${s.title}${s.duration != null ? ` (${s.duration}ms)` : ''}`).join('\n')}`,
    );
  }

  // D8: Console — include last N entries of any type in window before failure
  const consoleLogs = (rep.consoleLogs as ConsoleLogEntry[] | null) ?? [];
  const windowLogs = consoleLogs.slice(-limits.maxConsoleWindow);
  if (windowLogs.length > 0) {
    out.push(
      `### Console (last ${windowLogs.length} entries)\n${windowLogs.map((l) => `[${l.type}] ${l.text.slice(0, limits.consoleEntryChars)}`).join('\n')}`,
    );
  }

  // D9: Network — add slow-but-2xx and stalled alongside failures
  const nrItems = (rep as any).nrItems ?? [];
  const networkLines: string[] = [];
  const failedReqs = nrItems.filter((r: any) => r.status >= 400 || r.status === 0).slice(0, limits.networkRequests);
  const slowReqs = nrItems
    .filter((r: any) => r.status >= 200 && r.status < 400 && r.duration != null && r.duration > limits.slowRequestMs)
    .slice(0, limits.networkRequests);
  for (const r of failedReqs)
    networkLines.push(`- [failed] ${r.method} ${r.url} → ${r.status}${r.duration != null ? ` (${r.duration}ms)` : ''}`);
  for (const r of slowReqs)
    networkLines.push(`- [slow] ${r.method} ${r.url} → ${r.status}${r.duration != null ? ` (${r.duration}ms)` : ''}`);
  if (networkLines.length > 0) {
    out.push(`### Network Requests\n${networkLines.join('\n')}`);
  }

  // Backend server logs (aggregated from X-Piwi-Logs headers across all requests)
  if (limits.serverLogEntries > 0) {
    const allServerLogs: ServerLogEntry[] = [];
    for (const req of nrItems) {
      const logs = (req as any).serverLogs;
      if (Array.isArray(logs)) {
        for (const log of logs) allServerLogs.push(log as ServerLogEntry);
      }
    }
    allServerLogs.sort((a, b) => a.timestamp - b.timestamp);
    const shownServerLogs = allServerLogs.slice(0, limits.serverLogEntries);
    if (shownServerLogs.length > 0) {
      const lines: string[] = [];
      for (const l of shownServerLogs) {
        const prefix = l.category ? `[${l.level}] [${l.category}] ` : `[${l.level}] `;
        lines.push(prefix + l.message.slice(0, limits.serverLogEntryChars));
        if (l.stack) {
          for (const frame of l.stack.split('\n')) {
            lines.push(`  ${frame}`);
          }
        }
      }
      out.push(`### Backend Server Logs\n${lines.join('\n')}`);
    }
  }

  // Web vitals
  const webVitals = rep.webVitals as WebVitals | null;
  if (webVitals && (webVitals.navigation || webVitals.paint)) {
    const lines: string[] = [];
    const nav = webVitals.navigation;
    const paint = webVitals.paint;
    if (nav?.domContentLoaded != null) lines.push(`- DOMContentLoaded: ${nav.domContentLoaded}ms`);
    if (nav?.loadComplete != null) lines.push(`- Load complete: ${nav.loadComplete}ms`);
    if (paint?.FCP != null) lines.push(`- FCP: ${paint.FCP}ms`);
    if (paint?.LCP != null) lines.push(`- LCP: ${paint.LCP}ms`);
    if (lines.length > 0) out.push(`### Web Vitals\n${lines.join('\n')}`);
  }

  // ARIA snapshot (content-aware truncation)
  if (rep.ariaSnapshot) {
    const truncated = selectAriaForBudget(rep.ariaSnapshot, limits.ariaSnapshotChars);
    out.push(
      `### ARIA Snapshot (page state at failure)\n\`\`\`yaml\n${truncated}${truncated.length < rep.ariaSnapshot.length ? '\n[truncated]' : ''}\n\`\`\``,
    );
  }

  return out;
}

async function retryBehaviorSection(db: DbClient, cluster: FailureCluster): Promise<string | null> {
  const retryPassRows = await db
    .select({ count: testRunsCases.id })
    .from(testRunsCases)
    .where(
      and(
        eq(testRunsCases.failureClusterId, cluster.id),
        eq(testRunsCases.testRunId, cluster.lastSeenRunId),
        eq(testRunsCases.status, 'passed'),
      ),
    )
    .limit(1);

  if (retryPassRows.length === 0) return null;
  return `## Retry Behavior\nAt least one test in this cluster passed on retry in the last seen run (suggests flakiness).`;
}

/**
 * Score a changed file by relevance to the failing test.
 * Higher score = more likely to be the cause.
 */
function scoreChangedFile(filename: string, testFilePath?: string | null, ariaSnapshot?: string | null): number {
  let score = 0;

  // +++ file path matches the failing test's route (derive from test file path)
  if (testFilePath) {
    // Direct match: the changed file IS the test file
    if (filename === testFilePath) score += 3;
    // Try to derive the page route from the test file path
    // e.g. tests/user-management.spec.ts → app/pages/settings/users.vue
    const testFileLower = testFilePath.toLowerCase().replace(/\\/g, '/');
    const filenameLower = filename.toLowerCase().replace(/\\/g, '/');
    // Check if filename contains parts of the test file name
    const baseName = testFileLower.replace(/^.*[/\\]/, '').replace(/\.(spec|test)\.\w+$/, '');
    if (filenameLower.includes(baseName)) score += 2;
  }

  // ++ file is a component under app/components/
  if (filename.startsWith('app/components/') || filename.includes('/components/')) {
    score += 2;
  }

  // ++ file name tokens match role/text from the ARIA snapshot
  if (ariaSnapshot && filename.includes('/')) {
    const baseName = filename.split('/').pop()?.toLowerCase() ?? '';
    const ariaLower = ariaSnapshot.toLowerCase();
    // Component name like "SectionCard" → check if it appears in the snapshot
    const componentName = baseName
      .replace(/\.\w+$/, '')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .toLowerCase();
    if (componentName && ariaLower.includes(componentName)) score += 2;
  }

  // + file is under app/ (source code vs config/test/docs)
  if (filename.startsWith('app/')) {
    score += 1;
  }

  return score;
}

interface ScoredFile {
  file: ChangedFile;
  score: number;
}

function scoreFilesByRelevance(
  files: ChangedFile[],
  testFilePath?: string | null,
  ariaSnapshot?: string | null,
): ScoredFile[] {
  return files
    .map((f) => ({ file: f, score: scoreChangedFile(f.filename, testFilePath, ariaSnapshot) }))
    .sort((a, b) => b.score - a.score);
}

function getTopSuspectedCommit(
  scored: ScoredFile[],
  commits: Array<{ sha: string; message: string }>,
): { sha: string; message: string } | null {
  if (scored.length === 0 || commits.length === 0 || !scored[0]) return null;
  const topFile = scored[0];
  if (topFile?.score === 0) return null;
  // Return the most recent commit (last in the range, first in the array)
  return commits[0] ?? null;
}

/**
 * "What changed since last green run" + the actual SCM diff (or a manual-baseline
 * diff when there is no last green run). Tracks SCM coverage for the UI status line.
 */
async function scmInvestigationSections(
  db: DbClient,
  cluster: FailureCluster,
  opts: BuildContextOptions,
  limits: ContextLimits,
  /** The failing test's file path, used for relevance scoring. */
  testFilePath?: string | null,
  /** The failing test's ARIA snapshot, used for relevance scoring. */
  ariaSnapshot?: string | null,
): Promise<{
  sections: string[];
  coverage: ScmCoverage | null;
  scmChanges: ScmChanges | null;
  topSuspectedCommit: string | null;
}> {
  const sections: string[] = [];
  const scmCov: ScmCoverage = {
    hasLastGreen: false,
    hasCommitRange: false,
    baseCommitUsed: null,
    provider: null,
    commitsCount: 0,
    filesCount: 0,
    patchedFilesCount: 0,
    patchesOmitted: false,
    patchesTruncated: false,
  };
  let scmReached = false;
  let scmChanges: ScmChanges | null = null;

  const lastSeenRunRows = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      environment: testRuns.environment,
      metadata: testRuns.metadata,
    })
    .from(testRuns)
    .where(eq(testRuns.id, cluster.lastSeenRunId));

  if (!lastSeenRunRows[0]) return { sections, coverage: null, scmChanges: null, topSuspectedCommit: null };

  try {
    const regression = await computeRegressionContext(db, lastSeenRunRows[0]);
    scmReached = true;
    const baseCommitOverride = opts.baseCommit?.trim() || undefined;

    if (regression.hasGreen) {
      scmCov.hasLastGreen = true;
      scmCov.hasCommitRange = Boolean(regression.commitRange);

      const lines: string[] = [
        `## What Changed Since Last Green Run`,
        `- Last green run: #${regression.lastGreenRunId} (${regression.lastGreenRunAt.toISOString()})`,
        `- New failures in this run: ${regression.newFailures}`,
      ];
      if (regression.commitRange) {
        const fromShort = baseCommitOverride ? baseCommitOverride.slice(0, 7) : regression.commitRange.fromShort;
        lines.push(`- Commit range: ${fromShort}..${regression.commitRange.toShort}`);
        if (baseCommitOverride) lines.push(`- Note: baseline overridden by user to ${baseCommitOverride}`);
        lines.push(`- Git command: \`git log ${fromShort}..${regression.commitRange.toShort}\``);
      }
      if (regression.metadataDiff.length > 0) {
        lines.push(`- Changed metadata:`);
        for (const d of regression.metadataDiff) {
          lines.push(`  - ${d.label}: ${d.before ?? 'none'} → ${d.after ?? 'none'}`);
        }
      }
      sections.push(lines.join('\n'));

      // Fetch actual changed files from SCM API
      if (regression.commitRange?.repositoryUrl) {
        scmCov.provider = detectScmProvider(regression.commitRange.repositoryUrl);
        try {
          const provider = await createScmProvider(regression.commitRange.repositoryUrl, db, cluster.projectId);
          const fromSha = baseCommitOverride ?? regression.commitRange.fromSha;
          if (baseCommitOverride) scmCov.baseCommitUsed = baseCommitOverride;
          const changes = provider ? await provider.fetchChanges(fromSha, regression.commitRange.toSha) : null;
          if (changes && (changes.commits.length > 0 || changes.files.length > 0)) {
            // Score and sort files by relevance, then render with budget
            const scored = scoreFilesByRelevance(changes.files, testFilePath, ariaSnapshot);
            changes.files = scored.map((s) => s.file);
            scmChanges = changes;
            scmCov.filesCount = changes.files.length;
            scmCov.commitsCount = changes.commits.length;
            scmCov.patchesOmitted = Boolean(changes.patchesOmitted);

            const rendered = renderChangedFiles(changes, {
              title: '## Changed Files Since Last Green Run',
              budget: limits.scmPatchBudget,
            });
            scmCov.patchedFilesCount = rendered.patchedFilesCount;
            scmCov.patchesTruncated = rendered.patchesTruncated;
            sections.push(rendered.text);

            // Surface top suspected commit
            const topCommit = getTopSuspectedCommit(scored, changes.commits);
            if (topCommit) {
              sections.push(
                `### Top Suspected Change\nMost relevant change in range: \`${topCommit.sha.slice(0, 7)}\` (${topCommit.message})`,
              );
            }
          }
        } catch {
          // silently skip if SCM fetch fails
        }
      }
    } else if (baseCommitOverride) {
      // No last green run — user provided a manual baseline commit; try to fetch diff anyway
      const currMeta = lastSeenRunRows[0].metadata as RunMetadata | null;
      const currentCommit: string | null = currMeta?.scm?.commit ?? null;
      const remoteUrl: string | null = currMeta?.scm?.remoteUrl ?? null;
      const repositoryUrl = normalizeGitUrl(remoteUrl);

      scmCov.hasCommitRange = Boolean(currentCommit && repositoryUrl);

      if (currentCommit && repositoryUrl) {
        scmCov.provider = detectScmProvider(repositoryUrl);
        scmCov.baseCommitUsed = baseCommitOverride;

        const fromShort = baseCommitOverride.slice(0, 7);
        const toShort = currentCommit.slice(0, 7);
        sections.push(
          [
            `## What Changed (Manual Baseline)`,
            `- Baseline commit (user-provided): ${baseCommitOverride}`,
            `- Current commit: ${toShort}`,
            `- No previous passing run found; using manual baseline`,
            `- Git command: \`git log ${fromShort}..${toShort}\``,
          ].join('\n'),
        );

        try {
          const provider = await createScmProvider(repositoryUrl, db, cluster.projectId);
          const changes = provider ? await provider.fetchChanges(baseCommitOverride, currentCommit) : null;
          if (changes && (changes.commits.length > 0 || changes.files.length > 0)) {
            // Score and sort files by relevance
            const scored = scoreFilesByRelevance(changes.files, testFilePath, null);
            changes.files = scored.map((s) => s.file);
            scmChanges = changes;
            scmCov.filesCount = changes.files.length;
            scmCov.commitsCount = changes.commits.length;
            scmCov.patchesOmitted = Boolean(changes.patchesOmitted);

            const rendered = renderChangedFiles(changes, {
              title: '## Changed Files (Manual Baseline)',
              budget: limits.scmPatchBudget,
            });
            scmCov.patchedFilesCount = rendered.patchedFilesCount;
            scmCov.patchesTruncated = rendered.patchesTruncated;
            sections.push(rendered.text);

            const topCommit = getTopSuspectedCommit(scored, changes.commits);
            if (topCommit) {
              sections.push(
                `### Top Suspected Change\nMost relevant change in range: \`${topCommit.sha.slice(0, 7)}\` (${topCommit.message})`,
              );
            }
          }
        } catch {
          // silently skip
        }
      } else {
        sections.push(
          [
            `## What Changed (Manual Baseline)`,
            `> Note: baseline commit provided (${baseCommitOverride}) but could not determine current commit or repository URL from run metadata.`,
          ].join('\n'),
        );
      }
    }
  } catch {
    // omit section if regression context fails
  }

  return { sections, coverage: scmReached ? scmCov : null, scmChanges, topSuspectedCommit: null };
}

/** Diffs for commits the user explicitly picked, sharing one patch budget. */
async function selectedCommitsSection(
  db: DbClient,
  cluster: FailureCluster,
  opts: BuildContextOptions,
  limits: ContextLimits,
): Promise<string | null> {
  if (!opts.selectedCommitShas?.length) return null;
  try {
    const [runForUrl] = await db
      .select({ metadata: testRuns.metadata })
      .from(testRuns)
      .where(eq(testRuns.id, cluster.lastSeenRunId));
    const meta = runForUrl?.metadata as RunMetadata | null;
    const repoUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
    if (!repoUrl) return null;

    const provider = await createScmProvider(repoUrl, db, cluster.projectId);
    if (!provider) return null;

    const commitLines: string[] = ['## Commits Manually Selected for Context'];
    // Shared budget so the total patch size across all selected commits is capped.
    const budget = { remaining: limits.scmPatchBudget };
    for (const sha of opts.selectedCommitShas.slice(0, 10)) {
      try {
        const commitDiff = await provider.fetchCommitDiff(sha);
        if (commitDiff?.files.length) {
          commitLines.push(`\n### ${sha.slice(0, 7)}`);
          commitLines.push(`Changed files (${commitDiff.files.length}):`);
          for (const f of commitDiff.files) commitLines.push(formatChangedFileLine(f));
          const { patches } = renderBudgetedPatches(commitDiff.files, budget);
          if (patches.length) {
            commitLines.push(`\nPatches:\n\`\`\`diff\n${patches.join('\n\n')}\n\`\`\``);
          }
        }
      } catch {
        /* skip individual commit on error */
      }
    }
    return commitLines.length > 1 ? commitLines.join('\n') : null;
  } catch {
    /* skip entire block on error */
    return null;
  }
}

/**
 * Assemble the full markdown context sent to the AI for a failure cluster.
 * Returns the rendered text, SCM coverage (for the UI status line) and the raw
 * SCM changes (so the UI can render the diff without re-fetching).
 * @deprecated Use `buildDiagnosisContext` instead for scope-aware, sectioned output.
 */
export async function buildClusterDiagnosisContext(
  db: DbClient,
  cluster: FailureCluster,
  opts?: BuildContextOptions,
): Promise<{
  text: string;
  coverage: DiagnosisContextCoverage;
  scmChanges: ScmChanges | null;
  images?: AiAttachedImage[];
}> {
  const result = await buildDiagnosisContext(db, { kind: 'cluster', clusterId: cluster.id, ...opts });
  return { text: result.text, coverage: result.coverage, scmChanges: result.scmChanges, images: result.images };
}

// ── Scope-aware diagnosis context builder ────────────────────────────────────

/**
 * Build the full diagnosis context per the §7.0 contract. Scope-aware:
 * - `cluster` scope: evidence from a failure cluster (existing behavior + all §4 improvements).
 * - `execution` scope: evidence from a single test-runs-case, with optional cluster context.
 *
 * Returns a structured `BuiltDiagnosisContext` with sectioned markdown, coverage,
 * auto-resolved images, and a token estimate.
 */
export async function buildDiagnosisContext(
  db: DbClient,
  opts: DiagnosisScope & BuildContextOptions,
): Promise<BuiltDiagnosisContext> {
  const limits = await resolveContextLimits(db);
  const contextSections: ContextSection[] = [];
  let coverage: DiagnosisContextCoverage = { scm: null };
  let scmChanges: ScmChanges | null = null;
  let images: AiAttachedImage[] | undefined;
  let clusterInfo: BuiltDiagnosisContext['cluster'];

  const push = (cs: ContextSection | null | undefined) => {
    if (cs) contextSections.push(cs);
  };

  if (opts.kind === 'cluster') {
    const cluster = await db
      .select()
      .from(failureClusters)
      .where(eq(failureClusters.id, opts.clusterId))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!cluster) {
      throw new Error(`Failure cluster ${opts.clusterId} not found`);
    }

    clusterInfo = {
      id: cluster.id,
      signature: cluster.signature,
      occurrences: cluster.occurrences,
      pattern: 'unknown',
    };

    push(section('clusterSummary', 'Failure Cluster', clusterSummarySection(cluster)));
    push(section('sampleError', 'Sample Raw Error', sampleErrorSection(cluster, limits)));
    push(section('affectedTests', 'Affected Tests', await affectedTestsSection(db, cluster, limits), undefined));
    push(section('browserDistribution', 'Browser Distribution', await browserDistributionSection(db, cluster)));

    const rep = await loadRepresentativeExecution(db, cluster);
    if (rep) {
      const repSections = representativeExecutionSections(rep, cluster, limits);

      // First item is the representative execution header
      if (repSections.length > 0) {
        push(section('representativeExecution', 'Representative Execution', repSections[0]));
      }

      // Second item (if present) is execution error
      if (repSections.length > 1) {
        push(section('executionError', 'Execution Error', repSections[1]));
      }

      // Test source
      if (repSections.length > 2) {
        push(section('testSource', 'Test Source', repSections[2]));
      }

      // Steps
      if (repSections.length > 3) {
        push(section('steps', 'Steps', repSections[3], undefined));
      }

      // Console
      if (repSections.length > 4) {
        push(section('console', 'Console', repSections[4]));
      }

      // Network
      if (repSections.length > 5) {
        push(section('networkRequests', 'Network Requests', repSections[5]));
      }

      // Failing steps (D6)
      push(section('failingSteps', 'Failed Steps', failingStepsSection(rep, limits)));

      // Run context (partial run, parallelism, describe path, flaky class)
      push(section('runContext', 'Run Context', runContextSection(rep)));

      // Test annotations (@fixme/@flaky/@slow …)
      push(section('testAnnotations', 'Test Annotations', testAnnotationsSection(rep)));

      // Web vitals
      const vitalsSub = repSections.find((s) => s.startsWith('### Web Vitals'));
      if (vitalsSub) push(section('webVitals', 'Web Vitals', vitalsSub));

      // ARIA snapshot (D7: smarter truncation)
      const ariaSub = repSections.find((s) => s.startsWith('### ARIA Snapshot'));
      if (ariaSub) push(section('ariaSnapshot', 'ARIA Snapshot', ariaSub));

      // Server logs
      const logsSub = repSections.find((s) => s.startsWith('### Backend Server Logs'));
      if (logsSub) push(section('serverLogs', 'Backend Server Logs', logsSub));

      // Passed peers (with serial-mode detection)
      const peersResult = await passedPeersSection(db, rep, limits);
      if (peersResult.notApplicableReason) {
        coverage = {
          ...coverage,
          notApplicable: { ...coverage.notApplicable, passedPeers: peersResult.notApplicableReason },
        };
      } else {
        push(section('passedPeers', 'Passed Peers', peersResult.section));
      }

      // Nearest accessible-name hint for locator failures
      push(section('nearestAriaNames', 'Nearest Matching ARIA Names', nearestAriaNamesSection(rep)));

      // Compared to last pass (duration/vitals/console/steps deltas) + already-green check
      const baselineResult = await baselineComparisonSection(db, rep, cluster.lastSeenRunId);
      push(section('baselineComparison', 'Compared to Last Pass', baselineResult.section));
      if (baselineResult.alreadyGreen) {
        coverage = { ...coverage, alreadyGreen: true };
      }

      // Retry progression (per-attempt error evolution)
      push(section('retryProgression', 'Retry Progression', await retryProgressionSection(db, rep)));

      // D2/D3: Recurrence & flakiness
      const flakinessText = await recurrenceFlakinessSection(db, cluster, limits);
      push(section('recurrenceFlakiness', 'Recurrence & Flakiness', flakinessText));

      if (flakinessText) {
        if (flakinessText.includes('intermittent')) clusterInfo.pattern = 'intermittent';
        else if (flakinessText.includes('persistent')) clusterInfo.pattern = 'persistent';
      }

      // D12: Trace pointers
      push(section('tracePointers', 'Trace Files', await tracePointersSection(db, rep)));

      // B1: Failing action from trace parsing
      push(section('failingAction', 'Failing Action (from Trace)', await failingActionSection(db, rep, limits)));

      // Alternative locators from prior success / ARIA snapshot
      const healing = await locatorHealingSection(db, rep);
      push(section('locatorHealing', 'Alternative Locators (Locator Healing)', healing.section));
      if (healing.coverage) {
        coverage = { ...coverage, locatorHealing: healing.coverage };
      }

      // Attachments & artifacts (video, HAR, custom files) — pointers only
      push(section('artifacts', 'Attachments & Artifacts', await artifactsSection(db, rep)));

      // D1: Auto-resolve screenshots
      images = await resolveScreenshots(db, rep, limits);
      if (images.length > 0) {
        for (const img of images) {
          contextSections.push({
            id: 'screenshots' as SectionId,
            title: `Screenshot: ${img.name}`,
            chars: img.data.length,
            truncated: false,
            markdown: `![${img.name}](/api/files/screenshot)`,
          });
        }
      }

      // SCM investigation (network fetch) — skippable for the lean research pass
      if (!opts.skipScm) {
        const scm = await scmInvestigationSections(db, cluster, opts, limits, rep.testFilePath, rep.ariaSnapshot);
        for (const s of scm.sections) {
          if (s.startsWith('## What Changed')) {
            push(section('scmInvestigation', 'SCM Investigation', s));
          }
          // Top suspected commit section
          if (s.startsWith('### Top Suspected Change')) {
            push(section('topSuspectedCommit', 'Top Suspected Commit', s));
          }
        }
        coverage = { ...coverage, scm: scm.coverage };
        scmChanges = scm.scmChanges;

        // Selected commits (network fetch)
        push(
          section(
            'selectedCommits',
            'Manually Selected Commits',
            await selectedCommitsSection(db, cluster, opts, limits),
          ),
        );
      }

      // Retry behavior (DB only; kept for backward compat — folded into recurrenceFlakiness)
      push(section('scmInvestigation', 'SCM Investigation', await retryBehaviorSection(db, cluster)));
    }

    // D10: Prior diagnosis + triage note
    push(section('priorDiagnosis', 'Prior Assessment', await priorDiagnosisSection(db, cluster)));
  }

  const coverageBlock = buildCoverageBlock(contextSections);
  const text = [coverageBlock, ...contextSections.map((s) => s.markdown).filter(Boolean)].join('\n\n');
  const totalChars = contextSections.reduce((sum, s) => sum + s.chars, 0) + coverageBlock.length;

  return {
    scope:
      opts.kind === 'cluster'
        ? { kind: 'cluster', clusterId: opts.clusterId }
        : { kind: 'execution', testRunsCaseId: (opts as { testRunsCaseId: number }).testRunsCaseId },
    text,
    sections: contextSections,
    coverage,
    scmChanges,
    images,
    tokenEstimate: Math.ceil(totalChars / 4),
    cluster: clusterInfo,
  };
}
