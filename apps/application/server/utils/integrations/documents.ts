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
import type { DrizzleDB } from '#shared/handlers/db';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Jul 2026, 14:03 UTC" — deterministic, no locale/timezone drift. */
function fmtDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

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

/** Mint a share link for the cluster when the toggle is on and share links are enabled. */
async function resolveShareUrl(
  db: DrizzleDB,
  projectId: number,
  clusterId: number,
  opts: IssueBuildOpts,
): Promise<string | null> {
  if (!opts.includeShareLink) return null;
  const base = site(opts);
  if (!base) return null;
  // Loaded lazily so the module (and the demo bundle) never statically pulls in
  // `node:crypto`; share links are off by default, so this rarely runs.
  const { mintShareLink, shareLinksEnabled } = await import('../share-links');
  if (!shareLinksEnabled()) return null;
  try {
    const minted = await mintShareLink(db as never, {
      projectId,
      entityKind: 'cluster',
      entityId: clusterId,
      createdBy: null,
    });
    return `${base}/share/${minted.token}`;
  } catch {
    return null;
  }
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
  opts: IssueBuildOpts,
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
  const shareUrl = await resolveShareUrl(db, cluster.projectId, clusterId, opts);

  const facts: IssueFacts = {
    clusterId,
    fingerprint: cluster.fingerprint,
    title: titleOverride ?? describeCluster(cluster),
    headline: headlineDesc?.headline ?? null,
    errorType: cluster.errorType ?? null,
    firstSeen: fmtDate(cluster.firstSeenAt),
    lastSeen: fmtDate(cluster.lastSeenAt),
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
  opts: IssueBuildOpts = {},
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
  opts: IssueBuildOpts = {},
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
