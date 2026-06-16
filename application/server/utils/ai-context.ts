import { eq, and, desc, sql } from 'drizzle-orm';
import { testRunsCases, testCases, testRuns } from '../database/schema';
import type { FailureCluster } from '../database/schema';
import type { DiagnosisContextCoverage } from '~~/types/api';
import { stripAnsi } from '#shared/error-fingerprint';
import { computeRegressionContext, normalizeGitUrl } from './regression-context';
import { createScmProvider, detectScmProvider } from './scm';
import { MAX_RAW_DIFF_BYTES } from './scm/ScmProvider';
import type { ScmChanges, ChangedFile } from './scm/ScmProvider';
import type {
  BrowserConfig,
  ConsoleLogEntry,
  NetworkRequestEntry,
  RunMetadata,
  TestStepInfo,
  WebVitals,
} from './run-json-types';
import { resolveContextLimits } from './ai-context-limits';
import type { ContextLimits } from '#shared/ai-context-limits';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

type ScmCoverage = NonNullable<DiagnosisContextCoverage['scm']>;

export interface BuildContextOptions {
  baseCommit?: string;
  selectedCommitShas?: string[];
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

/** Latest run-case for this cluster, with its test info — the diagnosis's main evidence. */
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
      networkRequests: testRunsCases.networkRequests,
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

  return repRows[0] ?? null;
}

type RepresentativeRow = NonNullable<Awaited<ReturnType<typeof loadRepresentativeExecution>>>;

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

  out.push(`## Representative Execution (run #${rep.testRunId})
- Test: ${rep.testTitle}
- Location: ${location}
- Browser: ${browserStr || 'unknown'}
- Retries: ${rep.retries ?? 0}
- Duration: ${rep.duration != null ? `${rep.duration}ms` : 'unknown'}`);

  // Direct error from this execution (may be more detailed than cluster sampleError)
  if (rep.error && rep.error !== cluster.sampleError) {
    const clean = stripAnsi(rep.error);
    const truncated = clean.slice(0, limits.sampleErrorChars);
    out.push(
      `### Execution Error\n\`\`\`\n${truncated}${clean.length > limits.sampleErrorChars ? '\n[truncated]' : ''}\n\`\`\``,
    );
  }

  // Test source code snippet
  if (rep.testSource) {
    const truncated = rep.testSource.slice(0, limits.testSourceChars);
    out.push(
      `### Test Source\n\`\`\`typescript\n${truncated}${rep.testSource.length > limits.testSourceChars ? '\n[truncated]' : ''}\n\`\`\``,
    );
  }

  // Steps
  const steps = (rep.steps as TestStepInfo[] | null) ?? [];
  if (steps.length > 0) {
    const shown = steps.slice(-limits.steps);
    out.push(
      `### Steps (last ${shown.length})\n${shown.map((s) => `- [${s.category ?? 'step'}] ${s.title}${s.duration != null ? ` (${s.duration}ms)` : ''}`).join('\n')}`,
    );
  }

  // Console logs (errors and warnings only)
  const consoleLogs = (rep.consoleLogs as ConsoleLogEntry[] | null) ?? [];
  const relevantLogs = consoleLogs
    .filter((l) => l.type === 'error' || l.type === 'warning')
    .slice(0, limits.consoleEntries);
  if (relevantLogs.length > 0) {
    out.push(
      `### Console (errors/warnings)\n${relevantLogs.map((l) => `[${l.type}] ${l.text.slice(0, limits.consoleEntryChars)}`).join('\n')}`,
    );
  }

  // Failed network requests
  const networkRequests = (rep.networkRequests as NetworkRequestEntry[] | null) ?? [];
  const failedReqs = networkRequests.filter((r) => r.status >= 400 || r.status === 0).slice(0, limits.networkRequests);
  if (failedReqs.length > 0) {
    out.push(
      `### Failed Network Requests\n${failedReqs.map((r) => `${r.method} ${r.url} → ${r.status}${r.duration != null ? ` (${r.duration}ms)` : ''}`).join('\n')}`,
    );
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
 */
export async function buildClusterDiagnosisContext(
  db: DbClient,
  cluster: FailureCluster,
  opts?: BuildContextOptions,
): Promise<{ text: string; coverage: DiagnosisContextCoverage; scmChanges: ScmChanges | null }> {
  const o = opts ?? {};
  const limits = await resolveContextLimits(db);
  const sections: string[] = [];
  const push = (s: string | null | undefined) => {
    if (s) sections.push(s);
  };

  push(clusterSummarySection(cluster));
  push(sampleErrorSection(cluster, limits));
  push(await affectedTestsSection(db, cluster, limits));
  push(await browserDistributionSection(db, cluster));

  let coverage: DiagnosisContextCoverage = { scm: null };
  let scmChanges: ScmChanges | null = null;

  const rep = await loadRepresentativeExecution(db, cluster);
  if (rep) {
    for (const s of representativeExecutionSections(rep, cluster, limits)) push(s);
    push(await retryBehaviorSection(db, cluster));

    const scm = await scmInvestigationSections(db, cluster, o, limits);
    for (const s of scm.sections) push(s);
    coverage = { scm: scm.coverage };
    scmChanges = scm.scmChanges;
  }

  push(await selectedCommitsSection(db, cluster, o, limits));

  return { text: sections.join('\n\n'), coverage, scmChanges };
}
