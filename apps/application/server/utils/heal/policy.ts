/**
 * Decide whether a finished run should open a heal PR, and enqueue it.
 *
 * Mirrors `postRunPrFeedbackInBackground`'s resolution of the run's repository,
 * branch and commit — but writes to the repo, so the bar is higher: the feature
 * must be enabled, the project explicitly allowlisted, the run a full run on the
 * default branch (never a heal branch — that would feed on itself), and every
 * edit backed by high-confidence captured evidence. The chosen edit set is
 * snapshotted into a durable `heal_actions` row; the dispatcher does the writes.
 */
import { and, count, eq } from 'drizzle-orm';
import { healActions, projects, testCases, testRuns, testRunsCases } from '../../database/schema';
import { getLocatorHealingBatch } from '../locator-healing';
import { createScmProvider } from '../scm';
import { resolveOwners } from '../scm/ownership';
import { resolveDefaultBranch } from '../scm/default-branch';
import { resolveRunBranch } from '../run-branch';
import { normalizeGitUrl } from '../scm/git-url';
import { getAutoHealSettings, resolveHealSiteUrl } from './settings';
import { buildRetryCommand } from '#shared/retry-command';
import {
  healBranchName,
  healDedupeKey,
  healSignature,
  isHealBranch,
  type AutoHealSettings,
  type HealActionPayload,
  type HealEditPayload,
} from '#shared/auto-heal';
import type { LocatorHealingResult } from '#shared/locator-healing.types';
import type { RunMetadata } from '../run-json-types';
import type { DbClient } from '../../database';

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

/** Healing rungs whose scores are real stability scores (safe to threshold on). */
const ELIGIBLE_SOURCES = new Set<LocatorHealingResult['source']>(['prior-run', 'fingerprint', 'cross-test']);

/** One failing execution considered for healing. */
export interface HealCandidateRow {
  executionId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  clusterId: number | null;
  owner: string | null;
}

/**
 * From the failing executions and their healing results, choose the edits that
 * qualify — deterministic locator-line rewrites backed by a stored snapshot,
 * scoring at or above `minScore` (or a user's confirmed pick), one per call
 * site. Pure, so the decision is unit-testable without a database.
 */
export function selectHealEdits(
  rows: HealCandidateRow[],
  healing: Map<number, LocatorHealingResult>,
  opts: { minScore: number },
): HealEditPayload[] {
  const edits: HealEditPayload[] = [];
  const seenCallSites = new Set<string>();

  for (const row of rows) {
    const h = healing.get(row.executionId);
    const rec = h?.recommendation?.recommended;
    const edit = h?.edit;
    if (!h || h.applicable === false || !rec || !edit || !edit.unifiedDiff || !edit.filePath) continue;

    // Real captured evidence only — ARIA-snapshot guesses never open a PR.
    if (!ELIGIBLE_SOURCES.has(h.source)) continue;
    // A provably-stale prior name means the stored alternatives are suspect.
    if (h.priorNameMayBeStale && !rec.pickedByUser) continue;
    // Score gate, waived for a human's confirmed pick.
    if (!rec.pickedByUser && (rec.score ?? 0) < opts.minScore) continue;

    const key = `${edit.filePath}:${edit.line}`;
    if (seenCallSites.has(key)) continue;
    seenCallSites.add(key);

    edits.push({
      filePath: edit.filePath,
      line: edit.line,
      oldLine: edit.oldLine,
      newLine: edit.newLine,
      failingLocator: h.failingLocator ? `${h.failingLocator.method}(${JSON.stringify(h.failingLocator.args)})` : null,
      suggestedLocator: rec.locator,
      score: rec.score ?? null,
      source: h.source,
      pickedByUser: rec.pickedByUser === true,
      clusterId: row.clusterId,
      executionId: row.executionId,
      testTitle: row.title,
      owner: row.owner,
    });
  }

  return edits;
}

/** Build the verify command shown in the PR body — exactly the affected tests. */
function buildVerifyCommand(edits: HealEditPayload[], rows: HealCandidateRow[]): string {
  const byExecution = new Map(rows.map((r) => [r.executionId, r] as const));
  const cases = edits
    .map((e) => byExecution.get(e.executionId))
    .filter((r): r is HealCandidateRow => !!r)
    .map((r) => ({ filePath: r.filePath, title: r.title }));
  const fileCmd = buildRetryCommand(cases, { mode: 'file' });
  const titles = [...new Set(cases.map((c) => c.title))].slice(0, 5);
  const grep = titles.length ? ` -g "${titles.map((t) => t.replace(/["\\$`]/g, '\\$&')).join('|')}"` : '';
  return `${fileCmd || 'npx playwright test'}${grep}`;
}

type EnqueueResult = { enqueued: true; dedupeKey: string; edits: number } | { enqueued: false; reason: string };

/**
 * Enqueue a heal action for a finished run when it qualifies. Best-effort and
 * non-throwing at the call sites — every early return names why nothing was done.
 */
export async function maybeEnqueueHealAction(db: DbClient, runId: number): Promise<EnqueueResult> {
  const skip = (reason: string): EnqueueResult => ({ enqueued: false, reason });

  const settings: AutoHealSettings = await getAutoHealSettings(db);
  if (!settings.enabled) return skip('disabled');

  const siteUrl = resolveHealSiteUrl();
  if (!siteUrl) return skip('PIWI_SITE_URL is not set');

  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return skip('run not found');
  if (!settings.projects.includes(run.projectId)) return skip('project not allowlisted');
  if (run.isFullRun === 0) return skip('not a full run');

  const meta = (run.metadata as RunMetadata | null) ?? null;
  const branch = run.branch ?? resolveRunBranch(run.metadata);
  const commit = meta?.scm?.commit?.trim() || null;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
  if (!repositoryUrl) return skip('run has no repository URL in its SCM metadata');

  // Resolve the default branch through the shared chain (project setting → SCM
  // provider → reporter hint → 'main') so the "not the default branch" guard
  // fires even when the reporter recorded no `defaultBranch` in its metadata.
  const [project] = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, run.projectId));
  if (!project) return skip('project not found');
  const defaultBranch = await resolveDefaultBranch(db, project, run.metadata);

  const baseBranch = defaultBranch || branch;
  if (!baseBranch) return skip('run has no branch to target');
  if (branch && branch !== defaultBranch) return skip('run is not on the default branch');
  if (isHealBranch(branch, settings.branchPrefix)) return skip('run is on a heal branch');

  const provider = await createScmProvider(repositoryUrl, db, run.projectId);
  if (!provider) return skip(`unsupported SCM host for ${repositoryUrl}`);

  const rows: HealCandidateRow[] = (
    await db
      .select({
        executionId: testRunsCases.id,
        testCaseId: testRunsCases.testCaseId,
        status: testRunsCases.status,
        title: testCases.title,
        filePath: testCases.filePath,
        clusterId: testRunsCases.failureClusterId,
        owner: testCases.owner,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.testRunId, runId))
  )
    .filter((r) => FAIL_STATUSES.includes(r.status))
    .map((r) => ({
      executionId: r.executionId,
      testCaseId: r.testCaseId,
      title: r.title,
      filePath: r.filePath,
      clusterId: r.clusterId,
      owner: r.owner,
    }));
  if (rows.length === 0) return skip('run has no failing tests');

  // Fill each row's owner from CODEOWNERS when the test carries no annotation,
  // so the PR body can name a responsible team even on an un-annotated suite.
  const owners = await resolveOwners(db, run.projectId, rows).catch(() => new Map());
  const ownedRows = rows.map((r) => ({ ...r, owner: owners.get(r)?.owner ?? r.owner }));

  const healing = await getLocatorHealingBatch(
    db,
    ownedRows.map((r) => r.executionId),
  ).catch(() => new Map<number, LocatorHealingResult>());

  const edits = selectHealEdits(ownedRows, healing, { minScore: settings.minScore });
  if (edits.length === 0) return skip('no qualifying locator edits');

  const [{ value: openCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(healActions)
    .where(and(eq(healActions.projectId, run.projectId), eq(healActions.status, 'opened')));
  if (openCount >= settings.maxOpenPrs) return skip('max open heal PRs reached for this project');

  const signature = healSignature(edits);
  const dedupeKey = healDedupeKey(run.projectId, signature);
  const branchName = healBranchName(settings.branchPrefix, runId, signature);

  const payload: HealActionPayload = {
    repositoryUrl,
    provider: provider.provider,
    baseBranch,
    baseSha: commit,
    branch: branchName,
    commitMessage: settings.commitMessage,
    title: settings.commitMessage,
    draft: settings.draft,
    verifyCommand: buildVerifyCommand(edits, rows),
    edits,
  };

  const inserted = await db
    .insert(healActions)
    .values({
      projectId: run.projectId,
      runId,
      dedupeKey,
      kind: 'open-pr',
      status: 'pending',
      attempts: 0,
      payload,
      scheduledFor: new Date(),
    })
    .onConflictDoNothing({ target: healActions.dedupeKey })
    .returning({ id: healActions.id });
  if (inserted.length === 0) return skip('an identical heal action is already queued');

  return { enqueued: true, dedupeKey, edits: edits.length };
}

/** Fire-and-forget wrapper for the run-finalize paths. */
export function maybeEnqueueHealActionInBackground(db: DbClient, runId: number): void {
  maybeEnqueueHealAction(db, runId)
    .then(async (result) => {
      if (result.enqueued) {
        // Opportunistic dispatch; the scheduled sweeper is the safety net.
        const { sweepHealActions } = await import('./dispatch');
        await sweepHealActions(db);
      } else if (result.reason !== 'disabled') {
        console.info(`[auto-heal] nothing enqueued for run #${runId}: ${result.reason}`);
      }
    })
    .catch((e) => console.error('[auto-heal] maybeEnqueueHealAction failed', e));
}
