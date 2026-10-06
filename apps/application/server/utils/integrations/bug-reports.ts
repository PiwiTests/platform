/**
 * Bug reports and the tracker: what a send from Piwi Picker will do (the
 * intake answer the extension shows in its preview), filing a report through
 * the same `createIssue` path the dashboard's Create issue takes, and the
 * write-backs when a report's test says the bug looks fixed.
 */
import type { DbClient } from '../../database';
import { DEFAULT_LOCALE, toIssueLocale, type IssueLocale } from '#shared/integrations/messages';
import { readProjectIntegration } from './binding';
import { getConnectionRow, listTrackerConnections } from './connections';
import { createIssue, type CreateIssueOutcome } from './create';
import { enqueueBugLooksFixedPolicies } from './policies';

/** What a send to a project will do with the tracker, for the extension's preview. */
export interface BugReportIntake {
  /** The tracker the project is bound to, or null when it files nowhere. */
  tracker: 'jira' | null;
  projectKey: string | null;
  /** The language the ticket is written in. */
  locale: IssueLocale | null;
  /** The sender holds `issue:create` on the project. */
  canCreate: boolean;
  /** The project files every report, whoever sends it. */
  fileEvery: boolean;
}

interface Binding {
  connectionId: number;
  projectKey: string;
  issueType: string;
  locale: IssueLocale;
  labels: string[];
  assignee: string | null;
  fileEvery: boolean;
}

/** The project's complete binding to a tracker connection, or null. */
async function usableBinding(db: DbClient, projectId: number): Promise<Binding | null> {
  const binding = await readProjectIntegration(db, projectId);
  if (!binding.connectionId || !binding.projectKey || !binding.issueType) return null;
  const connections = await listTrackerConnections(db);
  if (!connections.some((c) => c.id === binding.connectionId)) return null;
  const connection = await getConnectionRow(db, binding.connectionId);
  const connectionLocale = toIssueLocale((connection?.config as { locale?: string } | null)?.locale);
  return {
    connectionId: binding.connectionId,
    projectKey: binding.projectKey,
    issueType: binding.issueType,
    locale: binding.locale ?? connectionLocale ?? DEFAULT_LOCALE,
    labels: binding.labels,
    assignee: binding.defaultAssignee,
    fileEvery: binding.policies.fileEveryBugReport,
  };
}

/** The intake answer for a sender; `canCreate` is whether they hold `issue:create` on the project. */
export async function bugReportIntake(db: DbClient, projectId: number, canCreate: boolean): Promise<BugReportIntake> {
  const binding = await usableBinding(db, projectId);
  if (!binding) return { tracker: null, projectKey: null, locale: null, canCreate: false, fileEvery: false };
  return {
    tracker: 'jira',
    projectKey: binding.projectKey,
    locale: binding.locale,
    canCreate,
    fileEvery: binding.fileEvery,
  };
}

/**
 * Files an issue for a report with the project's binding, through the outbox.
 * Null when the project is not bound to a tracker.
 */
export async function fileBugReportIssue(
  db: DbClient,
  input: { bugReportId: number; projectId: number; requestedBy: number | null },
): Promise<CreateIssueOutcome | null> {
  const binding = await usableBinding(db, input.projectId);
  if (!binding) return null;
  return createIssue(db, {
    entityType: 'bug_report',
    entityId: input.bugReportId,
    connectionId: binding.connectionId,
    projectKey: binding.projectKey,
    issueType: binding.issueType,
    labels: binding.labels,
    assignee: binding.assignee,
    locale: binding.locale,
    requestedBy: input.requestedBy,
    siteUrl: process.env.PIWI_SITE_URL ?? null,
  });
}

/** Whether a send files an issue: asked by a sender who may (`canCreate`), or the project files every report. */
export async function shouldFileOnSend(
  db: DbClient,
  projectId: number,
  asked: boolean,
  canCreate: boolean,
): Promise<boolean> {
  const intake = await bugReportIntake(db, projectId, canCreate);
  if (!intake.tracker) return false;
  return intake.fileEvery || (asked && intake.canCreate);
}

/** After a run moved reports, the write-backs for those that now look fixed. */
export async function followBugReportTickets(
  db: DbClient,
  runId: number,
  moved: Array<{ id: number; to: string; projectId?: number }>,
): Promise<void> {
  for (const change of moved) {
    if (change.to !== 'looks-fixed' || change.projectId == null) continue;
    await enqueueBugLooksFixedPolicies(db, { bugReportId: change.id, projectId: change.projectId, runId }).catch((e) =>
      console.error('[bug-reports] looks-fixed write-back failed', e),
    );
  }
}
