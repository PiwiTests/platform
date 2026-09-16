import { and, eq, isNotNull } from 'drizzle-orm';
import type {
  ConnectionInput,
  ConnectionSummary,
  ConnectionTestResult,
  ExistingIssueCandidate,
  IssueDraft,
} from '#shared/integrations/types';
import { renderMarkdown } from '#shared/integrations/render-markdown';
import { DEFAULT_LOCALE, type IssueLocale } from '#shared/integrations/messages';
import { resolveProjectIntegration, type ResolvedProjectIntegration } from '#shared/integrations/binding';
import { buildClusterIssue, buildExecutionIssue } from '~~/server/utils/integrations/documents';
import { entityLinks, testRunsCases } from '~~/server/database/schema';
import type { DrizzleDB } from '#shared/handlers/db';

/**
 * The demo has no server to reach Jira, so it ships one canned Jira connection
 * and answers the connection endpoints from constants. Nothing calls out.
 */
const DEMO_TIME = '2024-01-01T00:00:00.000Z';

const DEMO_CONNECTION: ConnectionSummary = {
  id: 1,
  provider: 'jira',
  name: 'DEMO',
  baseUrl: 'https://demo.atlassian.net',
  config: { flavor: 'cloud' },
  status: 'ok',
  lastCheckedAt: DEMO_TIME,
  lastError: null,
  managedBy: 'db',
  hasCredentials: true,
  hasWebhookToken: false,
  createdAt: DEMO_TIME,
  updatedAt: DEMO_TIME,
};

export function listDemoConnections(): { connections: ConnectionSummary[] } {
  return { connections: [DEMO_CONNECTION] };
}

export function getDemoConnection(id: number): { connection: ConnectionSummary } | null {
  return id === DEMO_CONNECTION.id ? { connection: DEMO_CONNECTION } : null;
}

export function createDemoConnection(body: ConnectionInput): { connection: ConnectionSummary } {
  return {
    connection: {
      ...DEMO_CONNECTION,
      id: 2,
      provider: body.provider,
      name: body.name,
      baseUrl: body.baseUrl,
      config: body.config ?? { flavor: 'cloud' },
      status: 'unverified',
      hasCredentials: !!body.credentials && Object.keys(body.credentials).length > 0,
    },
  };
}

export function updateDemoConnection(id: number, body: Partial<ConnectionInput>): { connection: ConnectionSummary } {
  return {
    connection: {
      ...DEMO_CONNECTION,
      id,
      name: body.name ?? DEMO_CONNECTION.name,
      baseUrl: body.baseUrl ?? DEMO_CONNECTION.baseUrl,
    },
  };
}

export function testDemoConnection(): ConnectionTestResult {
  return { ok: true, account: { id: 'demo-account', displayName: 'Demo User' } };
}

// ── Create-issue flow (in-browser, never calls out) ──────────────────────────

const DEMO_PROJECT_KEY = 'DEMO';
const DEMO_ISSUE_TYPE = 'Bug';

export function demoTrackerStatus(): { trackers: { id: number; provider: 'jira'; name: string }[] } {
  return { trackers: [{ id: DEMO_CONNECTION.id, provider: 'jira', name: DEMO_CONNECTION.name }] };
}

/** The cluster an entity belongs to (itself for a cluster, its cluster for an execution). */
async function resolveClusterId(
  db: DrizzleDB,
  entityType: 'failure_cluster' | 'test_runs_case',
  entityId: number,
): Promise<number | null> {
  if (entityType === 'failure_cluster') return entityId;
  const [row] = await db
    .select({ clusterId: testRunsCases.failureClusterId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, entityId));
  return row?.clusterId ?? null;
}

/** Jira-shaped links already pinned to the cluster, as dedupe candidates. */
async function demoExisting(db: DrizzleDB, clusterId: number): Promise<ExistingIssueCandidate[]> {
  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.failureClusterId, clusterId), isNotNull(entityLinks.key)));
  return links
    .filter((l) => l.provider === 'jira')
    .map((l) => ({
      key: l.key ?? '',
      url: l.url,
      title: l.title ?? null,
      statusText: l.statusText ?? null,
      statusColor: l.statusColor ?? null,
      reason: 'linked' as const,
    }));
}

export async function demoIssueDraft(
  db: DrizzleDB,
  entityType: 'failure_cluster' | 'test_runs_case',
  entityId: number,
  locale: IssueLocale = DEFAULT_LOCALE,
): Promise<IssueDraft | null> {
  const clusterId = await resolveClusterId(db, entityType, entityId);
  if (clusterId == null) return null;
  const built =
    entityType === 'failure_cluster'
      ? await buildClusterIssue(db, entityId, { locale })
      : await buildExecutionIssue(db, entityId, { locale });
  if (!built) return null;
  return {
    entityType,
    entityId,
    clusterId,
    title: built.title,
    connectionId: DEMO_CONNECTION.id,
    connections: [{ id: DEMO_CONNECTION.id, provider: 'jira', name: DEMO_CONNECTION.name }],
    projectKey: DEMO_PROJECT_KEY,
    issueType: DEMO_ISSUE_TYPE,
    labels: built.labels,
    assignee: null,
    locale,
    include: { includeDiagnosis: true, includePatch: true, includeScreenshot: false, includeShareLink: false },
    markdown: renderMarkdown(built.document),
    document: built.document,
    existing: await demoExisting(db, clusterId),
  };
}

/** File a DEMO-<n> issue and write the known-issue link into the in-browser DB. */
export async function demoCreateIssue(
  db: DrizzleDB,
  entityType: 'failure_cluster' | 'test_runs_case',
  entityId: number,
  title?: string | null,
): Promise<{ actionId: number; status: 'done'; key: string; url: string }> {
  const clusterId = (await resolveClusterId(db, entityType, entityId)) ?? entityId;
  const built =
    entityType === 'failure_cluster'
      ? await buildClusterIssue(db, entityId, {})
      : await buildExecutionIssue(db, entityId, {});

  const existing = await db.select().from(entityLinks).where(isNotNull(entityLinks.key));
  const n = 100 + existing.filter((l) => l.provider === 'jira').length + 1;
  const key = `${DEMO_PROJECT_KEY}-${n}`;
  const url = `${DEMO_CONNECTION.baseUrl}/browse/${key}`;

  const [row] = await db
    .insert(entityLinks)
    .values({
      failureClusterId: clusterId,
      url,
      provider: 'jira',
      key,
      title: title?.trim() || built?.title || key,
      statusText: 'To Do',
      statusColor: 'info',
      connectionId: DEMO_CONNECTION.id,
      externalId: String(10000 + n),
      origin: 'created',
      unfurledAt: new Date(),
    })
    .returning({ id: entityLinks.id });

  return { actionId: row?.id ?? n, status: 'done', key, url };
}

export function demoIntegrationActions(): { actions: [] } {
  return { actions: [] };
}

export function demoConnectionProjects(): { projects: { id: string; key: string; name: string }[] } {
  return { projects: [{ id: '1', key: DEMO_PROJECT_KEY, name: 'Demo project' }] };
}

export function demoConnectionIssueTypes(): { issueTypes: { id: string; name: string }[] } {
  return {
    issueTypes: [
      { id: '1', name: 'Bug' },
      { id: '2', name: 'Task' },
    ],
  };
}

export function demoAssignable(): { users: { id: string; displayName: string }[] } {
  return { users: [{ id: 'demo-account', displayName: 'Demo User' }] };
}

/** The project binding the demo shows — a canned Jira binding on the demo connection. */
export function getDemoProjectIntegration(): ResolvedProjectIntegration {
  return resolveProjectIntegration({
    connectionId: DEMO_CONNECTION.id,
    projectKey: DEMO_PROJECT_KEY,
    issueType: '1',
    labels: ['piwi'],
    locale: 'en',
  });
}

/** Echo the normalized binding back — the demo has nothing to persist to. */
export function saveDemoProjectIntegration(body: Partial<ResolvedProjectIntegration>): ResolvedProjectIntegration {
  return resolveProjectIntegration(body);
}

/** A fake webhook token so the Settings UI can render the once-shown value. */
export function generateDemoWebhookToken(): { token: string; url: string } {
  const token = 'demo-webhook-token';
  return { token, url: `/api/integrations/jira/webhook/${token}` };
}

/** The demo has no tracker to poll, so a sync sweep refreshes nothing. */
export function demoSyncTrackerLinks(): { refreshed: number; failed: number; skipped: number } {
  return { refreshed: 0, failed: 0, skipped: 0 };
}
