import { eq, and, desc, sql } from 'drizzle-orm';
import { failureDiagnoses, failureClusters, testRunsCases, testCases, testRuns, projects } from '../database/schema';
import type { FailureDiagnosis, FailureCluster } from '../database/schema';
import { DIAGNOSIS_JSON_SCHEMA, parseDiagnosisJson } from '#shared/ai-diagnosis';
import type { AiConfig, DiagnosisContextCoverage } from '~~/types/api';
import { stripAnsi } from '#shared/error-fingerprint';
import { callAiProvider } from './ai-provider';
import type { AiAttachedImage } from './ai-provider';
import { computeRegressionContext, normalizeGitUrl } from './regression-context';
import { createScmProvider, detectScmProvider } from './scm';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

// Context assembly caps (keep total ~12K tokens)
const MAX_SAMPLE_ERROR_CHARS = 3000;
const MAX_SCM_PATCH_BUDGET = 4000;
const MAX_AFFECTED_TESTS = 15;
const MAX_STEPS = 30;
const MAX_CONSOLE_ENTRIES = 15;
const MAX_CONSOLE_ENTRY_CHARS = 400;
const MAX_NETWORK_REQUESTS = 15;
const MAX_ARIA_SNAPSHOT_CHARS = 4000;
const MAX_TEST_SOURCE_CHARS = 3000;

const DIAGNOSIS_SYSTEM_PROMPT = `You are a senior test engineer diagnosing Playwright test failures.
You receive one failure cluster: several test failures sharing one normalized error signature, plus execution context. Identify the most likely root cause. If the evidence is insufficient to determine a single root cause with high confidence, list multiple plausible hypotheses ranked by likelihood with supporting evidence for each. Ground every claim in the provided evidence — quote selectors, URLs, status codes or step names rather than speculating.
If the evidence is insufficient, say so and lower your confidence.
Categories: app-bug (the application under test broke), test-bug (the test code/locators are wrong), flaky-test (timing/race, passes on retry), infrastructure (CI workers, browser crashes, resources), environment (config/URL/credentials differences), unknown.

For suggestedFix.patch: when you have enough context to determine the exact lines to change, output a standard unified diff that can be applied with \`git apply\`. Rules:
- Use the real file paths from the evidence (e.g. \`--- a/tests/foo.spec.ts\`, \`+++ b/tests/foo.spec.ts\`).
- Include correct \`@@ -L,N +L,N @@\` hunk headers.
- For test-bug: the patch should fix the test file using the test source provided.
- For app-bug with a git diff showing the regression: the patch should fix the application file (revert or correct the breaking change).
- Set patch to null if you are not confident in the exact lines, if the fix spans unknown files, or if no source was provided.
- Do not output a patch and a code snippet for the same fix; prefer patch when possible and set code to null.`;

const STALE_RUNNING_MS = 5 * 60 * 1000;

// Concurrency guard: prevent double-running for the same cluster
const running = new Set<number>();

export function isDiagnosisRunning(clusterId: number): boolean {
  return running.has(clusterId);
}

export async function buildClusterDiagnosisContext(
  db: DbClient,
  cluster: FailureCluster,
  opts?: { baseCommit?: string; selectedCommitShas?: string[] },
): Promise<{ text: string; coverage: DiagnosisContextCoverage }> {
  const sections: string[] = [];

  const scmCov: NonNullable<DiagnosisContextCoverage['scm']> = {
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

  // Cluster summary
  sections.push(`## Failure Cluster
- Signature: ${cluster.signature}
- Error type: ${cluster.errorType ?? 'unknown'}
- Selector: ${cluster.selector ?? 'none'}
- Triage status: ${cluster.status}
- Total occurrences: ${cluster.occurrences}
- First seen run: #${cluster.firstSeenRunId}
- Last seen run: #${cluster.lastSeenRunId}`);

  // Sample raw error
  if (cluster.sampleError) {
    const clean = stripAnsi(cluster.sampleError);
    const truncated = clean.slice(0, MAX_SAMPLE_ERROR_CHARS);
    sections.push(
      `## Sample Raw Error\n\`\`\`\n${truncated}${clean.length > MAX_SAMPLE_ERROR_CHARS ? '\n[truncated]' : ''}\n\`\`\``,
    );
  }

  // Affected tests
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
    .limit(MAX_AFFECTED_TESTS + 1);

  if (affectedRows.length > 0) {
    const shown = affectedRows.slice(0, MAX_AFFECTED_TESTS);
    const extra =
      affectedRows.length > MAX_AFFECTED_TESTS ? `\n…and ${affectedRows.length - MAX_AFFECTED_TESTS} more` : '';
    sections.push(
      `## Affected Tests\n${shown.map((t) => `- ${t.title} (${t.filePath}${t.line ? `:${t.line}` : ''})`).join('\n')}${extra}`,
    );
  }

  // Browser distribution across all failures
  const browserRows = await db
    .select({
      browser: testRunsCases.browser,
      count: sql<number>`COUNT(*)`,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, cluster.id))
    .groupBy(testRunsCases.browser);

  if (browserRows.length > 0) {
    const browserSummary = browserRows
      .map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = r.browser as any;
        const name = [b?.projectName, b?.browserName].filter(Boolean).join(' / ') || 'unknown';
        return `- ${name}: ${r.count} failure${r.count === 1 ? '' : 's'}`;
      })
      .join('\n');
    sections.push(`## Browser Distribution\n${browserSummary}`);
  }

  // Representative execution: latest run case for this cluster with test info
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

  const rep = repRows[0];
  if (rep) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = rep.browser as any;
    const browserStr = [browser?.projectName, browser?.browserName].filter(Boolean).join(' / ');
    const location = rep.line
      ? `${rep.testFilePath}:${rep.line}${rep.column ? `:${rep.column}` : ''}`
      : rep.testFilePath;

    sections.push(`## Representative Execution (run #${rep.testRunId})
- Test: ${rep.testTitle}
- Location: ${location}
- Browser: ${browserStr || 'unknown'}
- Retries: ${rep.retries ?? 0}
- Duration: ${rep.duration != null ? `${rep.duration}ms` : 'unknown'}`);

    // Direct error from this execution (may be more detailed than cluster sampleError)
    if (rep.error && rep.error !== cluster.sampleError) {
      const clean = stripAnsi(rep.error);
      const truncated = clean.slice(0, MAX_SAMPLE_ERROR_CHARS);
      sections.push(
        `### Execution Error\n\`\`\`\n${truncated}${clean.length > MAX_SAMPLE_ERROR_CHARS ? '\n[truncated]' : ''}\n\`\`\``,
      );
    }

    // Test source code snippet
    if (rep.testSource) {
      const truncated = rep.testSource.slice(0, MAX_TEST_SOURCE_CHARS);
      sections.push(
        `### Test Source\n\`\`\`typescript\n${truncated}${rep.testSource.length > MAX_TEST_SOURCE_CHARS ? '\n[truncated]' : ''}\n\`\`\``,
      );
    }

    // Steps
    const steps = (rep.steps as Array<{ title: string; duration?: number; category?: string }> | null) ?? [];
    if (steps.length > 0) {
      const shown = steps.slice(-MAX_STEPS);
      sections.push(
        `### Steps (last ${shown.length})\n${shown.map((s) => `- [${s.category ?? 'step'}] ${s.title}${s.duration != null ? ` (${s.duration}ms)` : ''}`).join('\n')}`,
      );
    }

    // Console logs (errors and warnings only)
    const consoleLogs = (rep.consoleLogs as Array<{ type: string; text: string }> | null) ?? [];
    const relevantLogs = consoleLogs
      .filter((l) => l.type === 'error' || l.type === 'warning')
      .slice(0, MAX_CONSOLE_ENTRIES);
    if (relevantLogs.length > 0) {
      sections.push(
        `### Console (errors/warnings)\n${relevantLogs.map((l) => `[${l.type}] ${l.text.slice(0, MAX_CONSOLE_ENTRY_CHARS)}`).join('\n')}`,
      );
    }

    // Failed network requests
    const networkRequests =
      (rep.networkRequests as Array<{ method: string; url: string; status: number; duration?: number }> | null) ?? [];
    const failedReqs = networkRequests.filter((r) => r.status >= 400 || r.status === 0).slice(0, MAX_NETWORK_REQUESTS);
    if (failedReqs.length > 0) {
      sections.push(
        `### Failed Network Requests\n${failedReqs.map((r) => `${r.method} ${r.url} → ${r.status}${r.duration != null ? ` (${r.duration}ms)` : ''}`).join('\n')}`,
      );
    }

    // Web vitals
    const webVitals = rep.webVitals as Record<string, unknown> | null;
    if (webVitals && (webVitals.navigation || webVitals.paint)) {
      const lines: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = webVitals.navigation as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paint = webVitals.paint as any;
      if (nav?.domContentLoaded != null) lines.push(`- DOMContentLoaded: ${nav.domContentLoaded}ms`);
      if (nav?.loadComplete != null) lines.push(`- Load complete: ${nav.loadComplete}ms`);
      if (paint?.FCP != null) lines.push(`- FCP: ${paint.FCP}ms`);
      if (paint?.LCP != null) lines.push(`- LCP: ${paint.LCP}ms`);
      if (lines.length > 0) sections.push(`### Web Vitals\n${lines.join('\n')}`);
    }

    // ARIA snapshot
    if (rep.ariaSnapshot) {
      const truncated = rep.ariaSnapshot.slice(0, MAX_ARIA_SNAPSHOT_CHARS);
      sections.push(
        `### ARIA Snapshot (page state at failure)\n\`\`\`yaml\n${truncated}${rep.ariaSnapshot.length > MAX_ARIA_SNAPSHOT_CHARS ? '\n[truncated]' : ''}\n\`\`\``,
      );
    }

    // Retry behavior
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

    if (retryPassRows.length > 0) {
      sections.push(
        `## Retry Behavior\nAt least one test in this cluster passed on retry in the last seen run (suggests flakiness).`,
      );
    }

    // What changed since green
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

    if (lastSeenRunRows[0]) {
      try {
        const regression = await computeRegressionContext(db, lastSeenRunRows[0]);
        scmReached = true;
        const baseCommitOverride = opts?.baseCommit?.trim() || undefined;

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
                scmCov.filesCount = changes.files.length;
                scmCov.commitsCount = changes.commits.length;
                scmCov.patchesOmitted = Boolean(changes.patchesOmitted);

                const changeLines: string[] = ['## Changed Files Since Last Green Run'];
                if (changes.commits.length > 0) {
                  changeLines.push('Commits:');
                  for (const c of changes.commits) {
                    changeLines.push(`- ${c.sha} ${c.message}`);
                  }
                }
                changeLines.push(`\nChanged files (${changes.files.length}):`);
                for (const f of changes.files) {
                  const stats = f.additions || f.deletions ? `, +${f.additions} -${f.deletions}` : '';
                  changeLines.push(`- ${f.filename} (${f.status}${stats})`);
                }
                if (changes.patchesOmitted) {
                  changeLines.push(
                    `\n> Note: diff omitted — raw diff exceeded size limit (${Math.round(200_000 / 1024)} KB). File names and line counts above are complete; no patch content available.`,
                  );
                } else {
                  let patchBudget = MAX_SCM_PATCH_BUDGET;
                  const patches: string[] = [];
                  let skippedByBudget = 0;
                  for (const f of changes.files) {
                    if (!f.patch) continue;
                    if (patchBudget <= 0) {
                      skippedByBudget++;
                      continue;
                    }
                    const patch =
                      f.patch.length > patchBudget
                        ? f.patch.slice(0, patchBudget) + '\n[... patch truncated ...]'
                        : f.patch;
                    patchBudget -= Math.min(f.patch.length, patchBudget);
                    patches.push(`--- ${f.filename}\n${patch}`);
                  }
                  if (patches.length > 0) {
                    changeLines.push(`\nPatches:\n\`\`\`diff\n${patches.join('\n\n')}\n\`\`\``);
                    scmCov.patchedFilesCount = patches.length;
                    scmCov.patchesTruncated = skippedByBudget > 0;
                  }
                  if (skippedByBudget > 0) {
                    changeLines.push(
                      `\n> Note: ${skippedByBudget} file patch${skippedByBudget > 1 ? 'es' : ''} omitted (context budget exhausted).`,
                    );
                  }
                }
                sections.push(changeLines.join('\n'));
              }
            } catch {
              // silently skip if SCM fetch fails
            }
          }
        } else if (baseCommitOverride) {
          // No last green run — user provided a manual baseline commit; try to fetch diff anyway
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const currMeta = lastSeenRunRows[0].metadata as any;
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
                scmCov.filesCount = changes.files.length;
                scmCov.commitsCount = changes.commits.length;
                scmCov.patchesOmitted = Boolean(changes.patchesOmitted);

                const changeLines: string[] = ['## Changed Files (Manual Baseline)'];
                if (changes.commits.length > 0) {
                  changeLines.push('Commits:');
                  for (const c of changes.commits) {
                    changeLines.push(`- ${c.sha} ${c.message}`);
                  }
                }
                changeLines.push(`\nChanged files (${changes.files.length}):`);
                for (const f of changes.files) {
                  const stats = f.additions || f.deletions ? `, +${f.additions} -${f.deletions}` : '';
                  changeLines.push(`- ${f.filename} (${f.status}${stats})`);
                }
                if (changes.patchesOmitted) {
                  changeLines.push(
                    `\n> Note: diff omitted — raw diff exceeded size limit (${Math.round(200_000 / 1024)} KB). File names and line counts above are complete; no patch content available.`,
                  );
                } else {
                  let patchBudget = MAX_SCM_PATCH_BUDGET;
                  const patches: string[] = [];
                  let skippedByBudget = 0;
                  for (const f of changes.files) {
                    if (!f.patch) continue;
                    if (patchBudget <= 0) {
                      skippedByBudget++;
                      continue;
                    }
                    const patch =
                      f.patch.length > patchBudget
                        ? f.patch.slice(0, patchBudget) + '\n[... patch truncated ...]'
                        : f.patch;
                    patchBudget -= Math.min(f.patch.length, patchBudget);
                    patches.push(`--- ${f.filename}\n${patch}`);
                  }
                  if (patches.length > 0) {
                    changeLines.push(`\nPatches:\n\`\`\`diff\n${patches.join('\n\n')}\n\`\`\``);
                    scmCov.patchedFilesCount = patches.length;
                    scmCov.patchesTruncated = skippedByBudget > 0;
                  }
                  if (skippedByBudget > 0) {
                    changeLines.push(
                      `\n> Note: ${skippedByBudget} file patch${skippedByBudget > 1 ? 'es' : ''} omitted (context budget exhausted).`,
                    );
                  }
                }
                sections.push(changeLines.join('\n'));
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
    }
  }

  // Manually selected commits
  if (opts?.selectedCommitShas?.length) {
    try {
      const [runForUrl] = await db
        .select({ metadata: testRuns.metadata })
        .from(testRuns)
        .where(eq(testRuns.id, cluster.lastSeenRunId));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = runForUrl?.metadata as any;
      const repoUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
      if (repoUrl) {
        const provider = await createScmProvider(repoUrl, db, cluster.projectId);
        if (provider) {
          const commitLines: string[] = ['## Commits Manually Selected for Context'];
          let patchBudget = MAX_SCM_PATCH_BUDGET;
          for (const sha of opts.selectedCommitShas.slice(0, 10)) {
            try {
              const commitDiff = await provider.fetchCommitDiff(sha);
              if (commitDiff?.files.length) {
                commitLines.push(`\n### ${sha.slice(0, 7)}`);
                commitLines.push(`Changed files (${commitDiff.files.length}):`);
                for (const f of commitDiff.files) {
                  const stats = f.additions || f.deletions ? ` +${f.additions} -${f.deletions}` : '';
                  commitLines.push(`- ${f.filename} (${f.status}${stats})`);
                }
                const patches: string[] = [];
                for (const f of commitDiff.files) {
                  if (!f.patch || patchBudget <= 0) continue;
                  const patch =
                    f.patch.length > patchBudget
                      ? f.patch.slice(0, patchBudget) + '\n[... patch truncated ...]'
                      : f.patch;
                  patchBudget -= Math.min(f.patch.length, patchBudget);
                  patches.push(`--- ${f.filename}\n${patch}`);
                }
                if (patches.length) {
                  commitLines.push(`\nPatches:\n\`\`\`diff\n${patches.join('\n\n')}\n\`\`\``);
                }
              }
            } catch {
              /* skip individual commit on error */
            }
          }
          if (commitLines.length > 1) sections.push(commitLines.join('\n'));
        }
      }
    } catch {
      /* skip entire block on error */
    }
  }

  return {
    text: sections.join('\n\n'),
    coverage: { scm: scmReached ? scmCov : null },
  };
}

export async function runClusterDiagnosis(
  db: DbClient,
  cluster: FailureCluster,
  config: AiConfig,
  _opts?: {
    force?: boolean;
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
  },
): Promise<FailureDiagnosis> {
  if (running.has(cluster.id)) {
    throw Object.assign(new Error('Diagnosis already running for this cluster'), { statusCode: 409 });
  }

  running.add(cluster.id);

  // Load custom instructions (global + project) to build combined system prompt
  const [globalInstructionsRow, projectRows] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    db
      .select({ diagnosisInstructions: projects.diagnosisInstructions })
      .from(projects)
      .where(eq(projects.id, cluster.projectId))
      .limit(1),
  ]);
  const globalInstructions = globalInstructionsRow?.value?.trim() || null;
  const projectInstructions = projectRows[0]?.diagnosisInstructions?.trim() || null;

  const systemParts: string[] = [DIAGNOSIS_SYSTEM_PROMPT];
  if (globalInstructions) systemParts.push(`## Global Analysis Instructions\n${globalInstructions}`);
  if (projectInstructions) systemParts.push(`## Project-Specific Context\n${projectInstructions}`);
  const systemPrompt = systemParts.join('\n\n');

  // Upsert to 'running' state
  await db
    .insert(failureDiagnoses)
    .values({
      clusterId: cluster.id,
      status: 'running',
      provider: config.provider,
      model: config.model || (config.provider === 'anthropic' ? 'claude-opus-4-8' : config.model),
      category: null,
      confidence: null,
      summary: null,
      rootCause: null,
      details: null,
      error: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: failureDiagnoses.clusterId,
      set: {
        status: 'running',
        provider: config.provider,
        model: config.model || (config.provider === 'anthropic' ? 'claude-opus-4-8' : config.model),
        category: null,
        confidence: null,
        summary: null,
        rootCause: null,
        details: null,
        error: null,
        inputTokens: null,
        outputTokens: null,
        durationMs: null,
        updatedAt: new Date(),
      },
    });

  const t0 = Date.now();

  try {
    const { text: userContent } = await buildClusterDiagnosisContext(db, cluster, {
      baseCommit: _opts?.baseCommit,
      selectedCommitShas: _opts?.selectedCommitShas,
    });
    const extra = _opts?.additionalContext?.trim();
    const fullUserContent = extra ? `${userContent}\n\n## Additional Context Provided by User\n${extra}` : userContent;
    const result = await callAiProvider(config, {
      system: systemPrompt,
      user: fullUserContent,
      jsonSchema: DIAGNOSIS_JSON_SCHEMA,
      images: _opts?.images,
    });
    const diagnosis = parseDiagnosisJson(result.text);

    const updated = await db
      .update(failureDiagnoses)
      .set({
        status: 'completed',
        model: result.model,
        category: diagnosis.category,
        confidence: diagnosis.confidence,
        summary: diagnosis.summary,
        rootCause: diagnosis.rootCause,
        details: {
          evidence: diagnosis.evidence,
          suggestedFix: diagnosis.suggestedFix,
          preventionTips: diagnosis.preventionTips,
        },
        error: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(failureDiagnoses.clusterId, cluster.id))
      .returning();

    return updated[0]!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db
      .update(failureDiagnoses)
      .set({
        status: 'failed',
        error: message.slice(0, 500),
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(failureDiagnoses.clusterId, cluster.id))
      .returning();

    return failed[0]!;
  } finally {
    running.delete(cluster.id);
  }
}

export function isDiagnosisStale(row: FailureDiagnosis): boolean {
  if (row.status !== 'running') return false;
  return Date.now() - row.updatedAt.getTime() > STALE_RUNNING_MS;
}

export async function autoDiagnoseRun(db: DbClient, projectId: number, runId: number): Promise<void> {
  const { resolveAiConfig } = await import('./ai-provider');
  const config = await resolveAiConfig(db);
  if (!config?.autoDiagnose) return;

  const clusters = await db
    .select()
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.firstSeenRunId, runId)))
    .limit(3);

  for (const cluster of clusters) {
    try {
      const existingRows = await db
        .select()
        .from(failureDiagnoses)
        .where(eq(failureDiagnoses.clusterId, cluster.id))
        .limit(1);

      const existing = existingRows[0];
      if (
        existing &&
        (existing.status === 'completed' || (existing.status === 'running' && !isDiagnosisStale(existing)))
      ) {
        continue;
      }

      if (running.has(cluster.id)) continue;

      await runClusterDiagnosis(db, cluster, config);
    } catch (e) {
      console.error('[ai-diagnosis] autoDiagnose failed for cluster', cluster.id, e);
    }
  }
}
