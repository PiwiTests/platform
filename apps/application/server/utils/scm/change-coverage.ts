/**
 * Change coverage at finish time — resolve the diff between the run-baseline
 * ladder's commit and the run's commit, join the changed files to observed
 * reach, persist `changes` edges and changed-unreached gaps, and hand the pull
 * request comment its "Uncovered changes" section.
 *
 * Everything here is best-effort: a run with no repository, no baseline commit
 * or no SCM token yields no section and no gaps, never an error.
 */

import { eq } from 'drizzle-orm';
import { projects, testRuns, failureClusters } from '../../database/schema';
import type { DbClient } from '../../database';
import type { RunMetadata } from '../run-json-types';
import { normalizeGitUrl, FALLBACK_DEFAULT_BRANCH } from './git-url';
import { resolveRunBranch } from '../run-branch';
import { resolveDefaultBranch } from './default-branch';
import { resolveFallbackBranch } from '#shared/handlers/baseline-scope';
import { selectBaselineRun } from '../branch-baseline';
import { createScmProvider } from './index';
import type { ScmProvider } from './ScmProvider';
import { computeChangeCoverage, extractTicketIds, type ChangeCoverage } from '#shared/handlers/change-coverage';
import {
  detectChangedUnreached,
  rankGap,
  upsertScenarioGaps,
  type ChangedFileReach,
  type ExposureInputs,
  type FileExposure,
} from '#shared/handlers/scenario-gaps';
import { ingestChangesEdges } from '../graph-ingest';
import type { PrChangeCoverage } from '#shared/pr-feedback';

/** Recent commits scanned per run to estimate churn, age and escape history. */
const CHURN_COMMIT_SCAN = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * DAY_MS;

/** Per-head-commit exposure cache, so the finish path and the comment share one scan. */
const exposureCache = new Map<string, Map<string, FileExposure>>();

export interface RunChangeCoverage {
  coverage: ChangeCoverage;
  pr: PrChangeCoverage;
}

/** Two repo-relative paths match when equal or one is a path-suffix of the other. */
function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

/**
 * Estimate per-file churn (commits in ~90 days), age (oldest scanned commit) and
 * escape history (a commit that also fixed a failure cluster), from a bounded
 * scan of recent commits. Cached per head commit.
 */
async function computeFileExposure(
  db: DbClient,
  projectId: number,
  provider: ScmProvider,
  headSha: string,
  baseBranch: string | null,
  files: string[],
): Promise<ExposureInputs> {
  const cached = exposureCache.get(headSha);
  if (cached) return { files: cached };

  const fixCommits = new Set<string>();
  const clusters = await db
    .select({ fixCommit: failureClusters.fixCommit })
    .from(failureClusters)
    .where(eq(failureClusters.projectId, projectId));
  for (const c of clusters) if (c.fixCommit) fixCommits.add(c.fixCommit);

  const perFile = new Map<string, FileExposure>();
  try {
    const commits = await provider.listCommits(CHURN_COMMIT_SCAN, baseBranch ?? undefined);
    const now = Date.now();
    for (const commit of commits) {
      const when = Date.parse(commit.date);
      if (Number.isFinite(when) && now - when > NINETY_DAYS_MS) continue;
      const diff = await provider.fetchCommitDiff(commit.sha);
      if (!diff) continue;
      const isFix = fixCommits.has(commit.sha);
      for (const changed of diff.files) {
        for (const file of files) {
          if (!pathsMatch(changed.filename, file)) continue;
          const fx = perFile.get(file) ?? { churn: 0, ageDays: 0, escaped: false };
          fx.churn = (fx.churn ?? 0) + 1;
          if (Number.isFinite(when)) fx.ageDays = Math.max(fx.ageDays ?? 0, Math.round((now - when) / DAY_MS));
          if (isFix) fx.escaped = true;
          perFile.set(file, fx);
        }
      }
    }
  } catch {
    // Rate limit or a token-less repo — exposure degrades to the neutral floor.
  }

  exposureCache.set(headSha, perFile);
  return { files: perFile };
}

/** A generic, honest draft suggestion for an uncovered changed file. */
function draftTitleFor(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  return `a scenario that exercises ${base}`;
}

/**
 * Compute change coverage for a finished, pull-request-stamped run: resolve the
 * diff, persist `changes` edges and changed-unreached gaps, and return the data
 * the comment renders. Returns null when there is no diff to report.
 */
export async function computeRunChangeCoverage(db: DbClient, runId: number): Promise<RunChangeCoverage | null> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return null;

  const meta = (run.metadata as RunMetadata | null) ?? null;
  const headSha = meta?.scm?.commit?.trim() || null;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
  const prNumberRaw = meta?.scm?.prNumber;
  const prNumber = prNumberRaw != null && Number.isFinite(Number(prNumberRaw)) ? Number(prNumberRaw) : null;
  if (!headSha || !repositoryUrl) return null;

  const [project] = await db
    .select({ id: projects.id, name: projects.name, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, run.projectId));
  if (!project) return null;

  const branch = run.branch ?? resolveRunBranch(meta);
  const defaultBranch = await resolveDefaultBranch(db, project, meta).catch(() => FALLBACK_DEFAULT_BRANCH);
  const fallback = resolveFallbackBranch(meta, defaultBranch);

  const baseline = await selectBaselineRun(db, {
    projectId: run.projectId,
    before: run.startTime,
    branch,
    environment: run.environment ?? null,
    fallbackBranch: fallback.branch,
  });
  const baseSha = ((baseline?.run.metadata as RunMetadata | null)?.scm?.commit ?? null)?.trim() || null;
  if (!baseSha || baseSha === headSha) return null;

  const provider = await createScmProvider(repositoryUrl, db, run.projectId);
  if (!provider) return null;

  const changes = await provider.fetchChanges(baseSha, headSha).catch(() => null);
  if (!changes || changes.files.length === 0) return null;

  const changedFiles = changes.files.map((f) => ({
    filePath: f.filename,
    additions: f.additions,
    deletions: f.deletions,
  }));

  const tickets = extractTicketIds(
    branch,
    fallback.branch,
    ...changes.commits.map((c) => c.message),
    prNumber != null ? `#${prNumber}` : null,
  );

  const coverage = await computeChangeCoverage(db, run.projectId, {
    changedFiles,
    runId,
    baseSha,
    headSha,
    baseBranch: fallback.branch,
    tickets,
    scmAvailable: true,
  });

  // Persist the `changes` edges: the head commit and every ticket → each file.
  await ingestChangesEdges(
    db,
    run.projectId,
    runId,
    headSha,
    tickets,
    changedFiles.map((f) => f.filePath),
  ).catch(() => {});

  // Rank and persist the changed-unreached gaps.
  const exposure = await computeFileExposure(
    db,
    run.projectId,
    provider,
    headSha,
    fallback.branch,
    changedFiles.map((f) => f.filePath),
  );
  const reaches: ChangedFileReach[] = coverage.files.map((f) => ({
    filePath: f.filePath,
    additions: f.additions,
    deletions: f.deletions,
    reachedInRun: f.reachedInRun,
    reachedCountHistory: f.reachedCountHistory,
    ticket: f.ticket,
  }));
  const gaps = detectChangedUnreached(reaches, runId, coverage.windowRuns).map((g) => rankGap(g, exposure));
  await upsertScenarioGaps(db, run.projectId, gaps, { runId, prNumber }).catch(() => {});

  return { coverage, pr: toPrChangeCoverage(coverage) };
}

/** Shape the coverage for the pull-request comment builder. */
export function toPrChangeCoverage(coverage: ChangeCoverage): PrChangeCoverage {
  return {
    totalFiles: coverage.files.length,
    uncoveredFiles: coverage.uncoveredFiles,
    reachedFiles: coverage.reachedFiles,
    ticketCount: coverage.tickets.filter((t) => t.ticket).length,
    windowRuns: coverage.windowRuns,
    baseBranch: coverage.baseBranch,
    tickets: coverage.tickets.map((group) => ({
      ticket: group.ticket,
      files: group.files.map((f) => ({
        filePath: f.filePath,
        additions: f.additions,
        deletions: f.deletions,
        reachedInRun: f.reachedInRun,
        reachedCountHistory: f.reachedCountHistory,
        draftTitle: f.reachedInRun ? null : draftTitleFor(f.filePath),
      })),
    })),
  };
}
