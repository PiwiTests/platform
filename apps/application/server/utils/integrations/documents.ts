/**
 * Gather what Piwi knows about a failure and hand it to the pure issue builder.
 *
 * The reading order and the section-by-section degradation live in
 * `#shared/integrations/build-issue`; this file only reads the database — the
 * cluster, its latest occurrence, the diagnosis and the fix plan — so a field
 * added to the fix plan reaches the ticket without a second edit. The fix plan's
 * own logic (patch, locator edits, verify command, reproduce recipe) is reused,
 * never duplicated.
 */
import { eq } from 'drizzle-orm';
import { failureClusters, testRuns, testRunsCases } from '../../database/schema';
import { buildFixPlan } from '../fix-plan';
import { getFailureCluster } from '#shared/handlers/failure-clusters';
import { describeCluster } from '#shared/describe-cluster';
import { caseHeadline } from '#shared/failure-verdict';
import { errorExcerpt } from '#shared/notification-events';
import { clusterClue } from '#shared/inbox-queues';
import { reproScript } from '#shared/reproduce';
import {
  buildIssue,
  type AffectedTestFact,
  type BuiltIssue,
  type IssueBuildOpts,
  type IssueFacts,
  type LocatorEditFact,
} from '#shared/integrations/build-issue';
import { DEFAULT_LOCALE, formatDate } from '#shared/integrations/messages';
import type { DrizzleDB } from '#shared/handlers/db';

function scmCommit(metadata: unknown): string | null {
  const scm = (metadata as { scm?: { commit?: string | null } } | null)?.scm;
  return scm?.commit ?? null;
}

function site(opts: IssueBuildOpts): string | null {
  const raw = opts.siteUrl?.trim();
  return raw ? raw.replace(/\/$/, '') : null;
}

/** A cluster/execution/run link on the configured site, or null when unset. */
function link(base: string | null, path: string): string | null {
  return base ? `${base}${path}` : null;
}

/**
 * Mints a share token for a cluster, or returns null when share links are off.
 * The server injects one that reads `server/utils/share-links`; the demo passes
 * none, so this module never imports `node:crypto` into the worker bundle.
 */
export type ShareTokenMinter = (projectId: number, clusterId: number) => Promise<string | null>;

/** The builder options: the pure `IssueBuildOpts` plus the server-side minter. */
export interface DocumentBuildOpts extends IssueBuildOpts {
  mintShareToken?: ShareTokenMinter | null;
}

/** The cluster's share URL when the toggle is on and a minter produced a token. */
async function resolveShareUrl(projectId: number, clusterId: number, opts: DocumentBuildOpts): Promise<string | null> {
  if (!opts.includeShareLink || !opts.mintShareToken) return null;
  const base = site(opts);
  if (!base) return null;
  const token = await opts.mintShareToken(projectId, clusterId);
  return token ? `${base}/share/${token}` : null;
}

interface GatheredFacts {
  facts: IssueFacts;
  projectId: number;
  fingerprint: string;
}

/**
 * Read the cluster's facts, pinning the evidence and the execution link to a
 * chosen occurrence (the caller's execution, or the cluster's latest).
 */
async function gatherClusterFacts(
  db: DrizzleDB,
  clusterId: number,
  occurrenceExecutionId: number | null,
  titleOverride: string | null,
  opts: DocumentBuildOpts,
): Promise<GatheredFacts | null> {
  const cluster = await getFailureCluster(db, clusterId);
  if (!cluster) return null;

  const executionId = occurrenceExecutionId ?? cluster.latestTestRunsCaseId ?? null;

  const [occurrence] = executionId
    ? await db
        .select({
          error: testRunsCases.error,
          steps: testRunsCases.steps,
          runId: testRunsCases.testRunId,
        })
        .from(testRunsCases)
        .where(eq(testRunsCases.id, executionId))
    : [];

  const runId = occurrence?.runId ?? cluster.lastSeenRunId ?? null;
  const [run] = runId
    ? await db
        .select({ branch: testRuns.branch, environment: testRuns.environment, metadata: testRuns.metadata })
        .from(testRuns)
        .where(eq(testRuns.id, runId))
    : [];

  const locale = opts.locale ?? DEFAULT_LOCALE;
  const headlineDesc = occurrence?.error ? caseHeadline({ error: occurrence.error, steps: occurrence.steps }) : null;
  const commit = scmCommit(run?.metadata ?? null);

  const affectedTests: AffectedTestFact[] = cluster.affectedTestCases
    .slice(0, 25)
    .map((t) => ({ title: t.title, filePath: t.filePath, owner: cluster.owner?.name ?? null }));

  const plan = await buildFixPlan(db, clusterId);
  const patch = opts.includePatch === false ? null : (plan?.diagnosis?.patch ?? null);
  const locatorEdits: LocatorEditFact[] = (plan?.edits ?? [])
    .filter((e) => e.suggestedLocator)
    .map((e) => ({
      filePath: e.filePath,
      line: e.line,
      failingLocator: e.failingLocator,
      suggestedLocator: e.suggestedLocator,
    }));
  const reproduceScript = plan && plan.reproduce.steps.length ? reproScript(plan.reproduce, 'bash') : null;

  const diagnosisSummary = opts.includeDiagnosis === false ? null : (cluster.diagnosis?.summary ?? null);
  const rootCause = opts.includeDiagnosis === false ? null : (plan?.diagnosis?.rootCause ?? null);
  const clue =
    clusterClue({
      errorType: cluster.errorType,
      selector: cluster.selector,
      fixVerification: cluster.fixVerification,
    })?.text ?? null;

  const base = site(opts);
  const shareUrl = await resolveShareUrl(cluster.projectId, clusterId, opts);

  const facts: IssueFacts = {
    clusterId,
    fingerprint: cluster.fingerprint,
    title: titleOverride ?? describeCluster(cluster),
    headline: headlineDesc?.headline ?? null,
    errorType: cluster.errorType ?? null,
    firstSeen: formatDate(locale, cluster.firstSeenAt),
    lastSeen: formatDate(locale, cluster.lastSeenAt),
    occurrences: cluster.occurrences ?? 0,
    affectedTests,
    branch: run?.branch ?? null,
    environment: run?.environment ?? null,
    commit: commit ? commit.slice(0, 12) : null,
    diagnosisSummary,
    rootCause,
    clue,
    errorExcerpt: errorExcerpt(occurrence?.error ?? cluster.sampleError ?? null) ?? null,
    failingLocator: cluster.selector ?? null,
    patch,
    locatorEdits,
    verifyCommand: plan?.verify.command ?? null,
    reproduceScript,
    clusterUrl: link(base, `/failure-clusters/${clusterId}`),
    executionUrl: executionId ? link(base, `/test-run-cases/${executionId}`) : null,
    runUrl: runId ? link(base, `/test-runs/${runId}`) : null,
    shareUrl,
  };

  return { facts, projectId: cluster.projectId, fingerprint: cluster.fingerprint };
}

export interface BuiltClusterIssue extends BuiltIssue {
  projectId: number;
}

/** Build the default cluster ticket. Returns null when the cluster is gone. */
export async function buildClusterIssue(
  db: DrizzleDB,
  clusterId: number,
  opts: DocumentBuildOpts = {},
): Promise<BuiltClusterIssue | null> {
  const gathered = await gatherClusterFacts(db, clusterId, null, null, opts);
  if (!gathered) return null;
  return { ...buildIssue(gathered.facts, opts), projectId: gathered.projectId };
}

/**
 * Build a ticket for one failing execution — the same body scoped to that
 * execution and its cluster. Returns null when the execution or its cluster is
 * gone (an execution never spawns a second ticket for a known cluster).
 */
export async function buildExecutionIssue(
  db: DrizzleDB,
  executionId: number,
  opts: DocumentBuildOpts = {},
): Promise<BuiltClusterIssue | null> {
  const [execution] = await db
    .select({
      failureClusterId: testRunsCases.failureClusterId,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, executionId));
  if (!execution?.failureClusterId) return null;

  const [cluster] = await db
    .select({ title: failureClusters.title, signature: failureClusters.signature })
    .from(failureClusters)
    .where(eq(failureClusters.id, execution.failureClusterId));
  const title = cluster?.title?.trim() || cluster?.signature || null;

  const gathered = await gatherClusterFacts(db, execution.failureClusterId, executionId, title, opts);
  if (!gathered) return null;
  return { ...buildIssue(gathered.facts, opts), projectId: gathered.projectId };
}
