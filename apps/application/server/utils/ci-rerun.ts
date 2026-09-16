/**
 * CI re-run — server-side settings access and the shared dispatch flow.
 *
 * The settings live on the project row (`projects.ciRerun`), the token is the
 * project's SCM token, and the provider is decided by the repository URL of the
 * cluster's most recent run. This module ties those together so the availability
 * check (for the button's enabled/disabled state) and the dispatch route agree.
 */
import { desc, eq } from 'drizzle-orm';
import { projects, testCases, testRuns, testRunsCases } from '../database/schema';
import { createScmProvider, detectScmProvider, resolveScmToken } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { buildRetryArgs } from '#shared/retry-command';
import { resolveCiRerunSettings, hasRerunTarget, type CiRerunSettings } from '#shared/ci-rerun';
import type { ScmProviderName } from '#shared/scm-urls';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';

/** The resolved CI re-run settings for a project (disabled defaults when unset). */
export async function getCiRerunSettings(db: DbClient, projectId: number): Promise<CiRerunSettings> {
  const [project] = await db.select({ ciRerun: projects.ciRerun }).from(projects).where(eq(projects.id, projectId));
  return resolveCiRerunSettings((project?.ciRerun as Partial<CiRerunSettings> | null) ?? null);
}

/** The repository URL from a cluster's most recent run, normalized, or null. */
export async function clusterRepositoryUrl(db: DbClient, lastSeenRunId: number): Promise<string | null> {
  const [run] = await db.select({ metadata: testRuns.metadata }).from(testRuns).where(eq(testRuns.id, lastSeenRunId));
  const meta = (run?.metadata as RunMetadata | null) ?? null;
  return normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
}

/** Why a cluster's "Re-run in CI" button is not available, or null when it is. */
export interface CiRerunAvailability {
  available: boolean;
  /** Human-readable reason the button is disabled, for its tooltip. */
  reason: string | null;
  provider: ScmProviderName | null;
  enabled: boolean;
  hasToken: boolean;
}

/**
 * Decide whether a cluster can be re-run in CI, with a reason when it cannot —
 * the same checks the dispatch route enforces, so the button never offers an
 * action the POST would reject.
 */
export async function ciRerunAvailability(
  db: DbClient,
  projectId: number,
  lastSeenRunId: number,
): Promise<CiRerunAvailability> {
  const settings = await getCiRerunSettings(db, projectId);
  const repositoryUrl = await clusterRepositoryUrl(db, lastSeenRunId);
  const provider = detectScmProvider(repositoryUrl);
  const hasToken = Boolean(await resolveScmToken(db, projectId));

  if (!settings.enabled) {
    return { available: false, reason: 'CI re-run is off for this project.', provider, enabled: false, hasToken };
  }
  if (!provider) {
    return {
      available: false,
      reason: 'This cluster has no supported repository to dispatch to.',
      provider: null,
      enabled: true,
      hasToken,
    };
  }
  if (!hasRerunTarget(settings, provider)) {
    return {
      available: false,
      reason: `No ${provider} re-run target is configured for this project.`,
      provider,
      enabled: true,
      hasToken,
    };
  }
  if (!hasToken) {
    return {
      available: false,
      reason: 'No SCM token is configured to dispatch the re-run.',
      provider,
      enabled: true,
      hasToken: false,
    };
  }
  return { available: true, reason: null, provider, enabled: true, hasToken: true };
}

/** The Playwright arguments to re-run exactly a cluster's affected tests (file-line). */
export async function clusterRerunArgs(db: DbClient, clusterId: number): Promise<string> {
  const rows = await db
    .select({ title: testCases.title, filePath: testCases.filePath })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.failureClusterId, clusterId))
    .groupBy(testCases.id, testCases.title, testCases.filePath)
    .orderBy(desc(testCases.id))
    .limit(100);
  return buildRetryArgs(rows.map((r) => ({ filePath: r.filePath, title: r.title, line: null, projectName: null })));
}

/**
 * Dispatch a CI re-run of a cluster's affected tests. Assumes availability was
 * already checked (the route does). Returns the provider's runs/pipeline URL and
 * the args sent. Throws with the provider's message on a dispatch failure.
 */
export async function dispatchClusterRerun(
  db: DbClient,
  cluster: { id: number; projectId: number; lastSeenRunId: number },
): Promise<{ url: string; args: string; provider: ScmProviderName }> {
  const settings = await getCiRerunSettings(db, cluster.projectId);
  const repositoryUrl = await clusterRepositoryUrl(db, cluster.lastSeenRunId);
  const provider = detectScmProvider(repositoryUrl);
  if (!repositoryUrl || !provider) throw new Error('No supported repository to dispatch to');

  const scm = await createScmProvider(repositoryUrl, db, cluster.projectId);
  if (!scm) throw new Error('Could not build an SCM client for this repository');

  const args = await clusterRerunArgs(db, cluster.id);
  const { url } = await scm.dispatchRerun(settings, args);
  return { url, args, provider };
}
