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
      testTitle: testCases.title,
      testFilePath: testCases.filePath,
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

/** Tests in the same file that passed in the representative execution's run (D5). */
async function passedPeersSection(db: DbClient, rep: RepresentativeRow, limits: ContextLimits): Promise<string | null> {
  const testFilePath = rep.testFilePath;
  if (!testFilePath) return null;
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

  if (peers.length === 0) return null;
  const shown = peers.slice(0, limits.maxPassedPeers);
  const extra = peers.length > limits.maxPassedPeers ? `\n…and ${peers.length - limits.maxPassedPeers} more` : '';
  return `## Passed Peers\n${shown.map((t) => `- ${t.title}`).join('\n')}${extra}`;
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

  // ARIA snapshot
  if (rep.ariaSnapshot) {
    const truncated = rep.ariaSnapshot.slice(0, limits.ariaSnapshotChars);
    out.push(
      `### ARIA Snapshot (page state at failure)\n\`\`\`yaml\n${truncated}${rep.ariaSnapshot.length > limits.ariaSnapshotChars ? '\n[truncated]' : ''}\n\`\`\``,
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
 * "What changed since last green run" + the actual SCM diff (or a manual-baseline
 * diff when there is no last green run). Tracks SCM coverage for the UI status line.
 */
async function scmInvestigationSections(
  db: DbClient,
  cluster: FailureCluster,
  opts: BuildContextOptions,
  limits: ContextLimits,
): Promise<{ sections: string[]; coverage: ScmCoverage | null; scmChanges: ScmChanges | null }> {
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

  if (!lastSeenRunRows[0]) return { sections, coverage: null, scmChanges: null };

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

  return { sections, coverage: scmReached ? scmCov : null, scmChanges };
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
): Promise<{ text: string; coverage: DiagnosisContextCoverage; scmChanges: ScmChanges | null }> {
  const result = await buildDiagnosisContext(db, { kind: 'cluster', clusterId: cluster.id, ...opts });
  return { text: result.text, coverage: result.coverage, scmChanges: result.scmChanges };
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

      // Web vitals
      const vitalsSub = repSections.find((s) => s.startsWith('### Web Vitals'));
      if (vitalsSub) push(section('webVitals', 'Web Vitals', vitalsSub));

      // ARIA snapshot (D7: smarter truncation)
      const ariaSub = repSections.find((s) => s.startsWith('### ARIA Snapshot'));
      if (ariaSub) push(section('ariaSnapshot', 'ARIA Snapshot', ariaSub));

      // Server logs
      const logsSub = repSections.find((s) => s.startsWith('### Backend Server Logs'));
      if (logsSub) push(section('serverLogs', 'Backend Server Logs', logsSub));

      // D5: Passed peers
      push(section('passedPeers', 'Passed Peers', await passedPeersSection(db, rep, limits)));

      // D2/D3: Recurrence & flakiness
      const flakinessText = await recurrenceFlakinessSection(db, cluster, limits);
      push(section('recurrenceFlakiness', 'Recurrence & Flakiness', flakinessText));

      if (flakinessText) {
        if (flakinessText.includes('intermittent')) clusterInfo.pattern = 'intermittent';
        else if (flakinessText.includes('persistent')) clusterInfo.pattern = 'persistent';
      }

      // D12: Trace pointers
      push(section('tracePointers', 'Trace Files', await tracePointersSection(db, rep)));

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

      // SCM investigation
      const scm = await scmInvestigationSections(db, cluster, opts, limits);
      for (const s of scm.sections) {
        if (s.startsWith('## What Changed')) {
          push(section('scmInvestigation', 'SCM Investigation', s));
        }
      }
      coverage = { scm: scm.coverage };
      scmChanges = scm.scmChanges;

      // Retry behavior (kept for backward compat — folded into recurrenceFlakiness)
      push(section('scmInvestigation', 'SCM Investigation', await retryBehaviorSection(db, cluster)));

      // Selected commits
      push(
        section(
          'selectedCommits',
          'Manually Selected Commits',
          await selectedCommitsSection(db, cluster, opts, limits),
        ),
      );
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
