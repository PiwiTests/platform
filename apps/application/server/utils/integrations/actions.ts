/**
 * The integration outbox — every outbound write to a tracker is a durable row,
 * retried with backoff, deduped by a unique key, and listable. It is the third
 * instance of the shape auto-heal and notifications already use; the retry
 * arithmetic is shared through `server/utils/outbox.ts`.
 *
 * A click enqueues an action and asks for one immediate attempt (`runActionNow`),
 * so the issue resolves in a single round-trip when Jira is up and degrades to a
 * background retry (`sweepIntegrationActions`, every minute) when it is not. A
 * successful `create-issue` writes the entity link and the result together.
 */
import { and, eq, lt, lte } from 'drizzle-orm';
import { integrationActions } from '../../database/schema';
import type { DbClient } from '../../database';
import type { IssueDocument } from '#shared/integrations/document';
import type { IssueLocale } from '#shared/integrations/messages';
import type { LinkEntityType } from '#shared/handlers/links';
import type { IntegrationAction } from '../../database/schema';
import type { IssueTracker } from './types';
import { createTracker } from './connections';
import { JiraError } from './jira/client';
import { writeCreatedIssueLink } from './entity-links';
import { nextAttempt, OUTBOX_MAX_ATTEMPTS } from '../outbox';

/** The snapshot a `create-issue` action carries — enough to retry deterministically. */
export interface CreateIssueActionPayload {
  projectKey: string;
  issueType: string;
  title: string;
  document: IssueDocument;
  labels: string[];
  assigneeId?: string | null;
  priority?: string | null;
  componentId?: string | null;
  /** The language the body was rendered in, so a retry stays consistent. */
  locale?: IssueLocale;
  /** The entity the created known-issue link attaches to — normally the cluster. */
  linkEntityType: LinkEntityType;
  linkEntityId: number;
}

/** A comment action's snapshot — the rendered body, keyed to an issue. */
export interface CommentActionPayload {
  issueKey: string;
  document: IssueDocument;
}

/**
 * A transition action's snapshot. `transitionId` is resolved at binding time; a
 * `statusName` lets the action match a transition by its target status against
 * the actual issue's transitions when the id is unknown (a French-configured
 * site names them in French, so the match is on the site's own names, by id).
 */
export interface TransitionActionPayload {
  issueKey: string;
  transitionId?: string | null;
  statusName?: string | null;
}

export interface CreateIssueResult {
  key: string;
  url: string;
  issueId: string | null;
}

export interface EnqueueInput {
  connectionId: number;
  projectId: number;
  kind: string;
  entityType: string;
  entityId: number;
  dedupeKey: string;
  payload: unknown;
  requestedBy?: number | null;
}

/**
 * Enqueue an action. A duplicate dedupe key is a no-op that returns the existing
 * row — a second click, or a duplicate event, never files twice.
 */
export async function enqueueAction(db: DbClient, input: EnqueueInput): Promise<IntegrationAction> {
  const [existing] = await db
    .select()
    .from(integrationActions)
    .where(eq(integrationActions.dedupeKey, input.dedupeKey));
  if (existing) return existing;

  const [row] = await db
    .insert(integrationActions)
    .values({
      connectionId: input.connectionId,
      projectId: input.projectId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      dedupeKey: input.dedupeKey,
      status: 'pending',
      attempts: 0,
      scheduledFor: new Date(),
      payload: input.payload as never,
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  // A racing insert can still lose the unique-key contest — fall back to the winner.
  if (!row) {
    const [winner] = await db
      .select()
      .from(integrationActions)
      .where(eq(integrationActions.dedupeKey, input.dedupeKey));
    return winner!;
  }
  return row;
}

/** Retry-after seconds carried on a 429, in milliseconds, or null. */
function retryAfterMs(err: unknown): number | null {
  if (err instanceof JiraError && err.retryAfterSeconds != null) return err.retryAfterSeconds * 1000;
  return null;
}

/** Perform one create-issue against the tracker and record the link + result. */
async function applyCreateIssue(
  db: DbClient,
  tracker: IssueTracker,
  action: IntegrationAction,
): Promise<CreateIssueResult> {
  const payload = action.payload as CreateIssueActionPayload;
  const created = await tracker.createIssue({
    projectKey: payload.projectKey,
    issueType: payload.issueType,
    title: payload.title,
    body: payload.document,
    labels: payload.labels,
    assigneeId: payload.assigneeId ?? null,
    priority: payload.priority ?? null,
    componentId: payload.componentId ?? null,
  });
  // The create response carries no status; read it back once so the chip shows a
  // status the moment the key exists (best-effort — the key still lands if not).
  const enriched = (await tracker.getIssue(created.key).catch(() => null)) ?? created;
  const issue = { ...created, ...enriched, id: created.id ?? enriched.id };
  const result: CreateIssueResult = { key: issue.key, url: issue.url, issueId: issue.id };

  await db.transaction(async (tx) => {
    await writeCreatedIssueLink(tx as unknown as DbClient, {
      entityType: payload.linkEntityType,
      entityId: payload.linkEntityId,
      connectionId: action.connectionId,
      createdBy: action.requestedBy ?? null,
      issue: {
        provider: tracker.provider,
        url: issue.url,
        key: issue.key,
        externalId: issue.id,
        title: issue.title,
        statusText: issue.status,
        statusColor: issue.statusColor,
      },
    });
    await tx
      .update(integrationActions)
      .set({ status: 'done', result: result as never, error: null, attempts: action.attempts, finishedAt: new Date() })
      .where(eq(integrationActions.id, action.id));
  });

  return result;
}

/** Perform one comment against the tracker (used from the sync milestone). */
async function applyComment(tracker: IssueTracker, action: IntegrationAction): Promise<void> {
  const payload = action.payload as CommentActionPayload;
  await tracker.addComment(payload.issueKey, payload.document);
}

/**
 * Perform one transition. Prefers the configured id; falls back to the
 * transition whose target status name matches (case-insensitively), read from
 * the actual issue so the match is on the site's own names. A no-op when the
 * transition is not available (already there, or renamed away).
 */
async function applyTransition(tracker: IssueTracker, action: IntegrationAction): Promise<void> {
  const payload = action.payload as TransitionActionPayload;
  const available = await tracker.listTransitions(payload.issueKey);
  let target = payload.transitionId ? available.find((t) => t.id === payload.transitionId) : undefined;
  if (!target && payload.statusName) {
    const wanted = payload.statusName.trim().toLowerCase();
    target =
      available.find((t) => (t.toStatus ?? '').trim().toLowerCase() === wanted) ??
      available.find((t) => t.name.trim().toLowerCase() === wanted);
  }
  if (!target) return;
  await tracker.transition(payload.issueKey, target.id);
}

export type ActionOutcome =
  | { status: 'done'; result?: unknown }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/**
 * Run one action once. Marks the row terminal on success or skip; on failure
 * bumps attempts and reschedules with backoff (honoring a 429 `Retry-After`)
 * until the cap turns it `failed`. Returns the outcome for the caller.
 */
export async function runAction(db: DbClient, action: IntegrationAction): Promise<ActionOutcome> {
  const now = new Date();
  const attempts = action.attempts + 1;

  const tracker = await createTracker(db, action.connectionId);
  if (!tracker) {
    await db
      .update(integrationActions)
      .set({ status: 'skipped', error: 'connection has no usable credentials', attempts, finishedAt: now })
      .where(eq(integrationActions.id, action.id));
    return { status: 'skipped', reason: 'connection has no usable credentials' };
  }

  try {
    if (action.kind === 'create-issue') {
      const result = await applyCreateIssue(db, tracker, { ...action, attempts });
      return { status: 'done', result };
    }
    if (action.kind === 'comment') {
      await applyComment(tracker, action);
      await db
        .update(integrationActions)
        .set({ status: 'done', error: null, attempts, finishedAt: now })
        .where(eq(integrationActions.id, action.id));
      return { status: 'done' };
    }
    if (action.kind === 'transition') {
      await applyTransition(tracker, action);
      await db
        .update(integrationActions)
        .set({ status: 'done', error: null, attempts, finishedAt: now })
        .where(eq(integrationActions.id, action.id));
      return { status: 'done' };
    }
    await db
      .update(integrationActions)
      .set({ status: 'skipped', error: `unsupported action kind '${action.kind}'`, attempts, finishedAt: now })
      .where(eq(integrationActions.id, action.id));
    return { status: 'skipped', reason: `unsupported action kind '${action.kind}'` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = nextAttempt(attempts, now, action.scheduledFor, retryAfterMs(err));
    await db
      .update(integrationActions)
      .set({
        status: next.status,
        attempts,
        error: message,
        scheduledFor: next.scheduledFor,
        finishedAt: next.status === 'failed' ? now : null,
      })
      .where(eq(integrationActions.id, action.id));
    console.error(`[integrations] action ${action.id} failed (attempt ${attempts}/${OUTBOX_MAX_ATTEMPTS}): ${message}`);
    return { status: 'failed', error: message };
  }
}

/** Run one action immediately by id (the click path), regardless of its schedule. */
export async function runActionNow(db: DbClient, id: number): Promise<ActionOutcome | null> {
  const [action] = await db.select().from(integrationActions).where(eq(integrationActions.id, id));
  if (!action) return null;
  if (action.status !== 'pending') {
    if (action.status === 'done') return { status: 'done', result: action.result };
    if (action.status === 'skipped') return { status: 'skipped', reason: action.error ?? '' };
    return { status: 'failed', error: action.error ?? '' };
  }
  return runAction(db, action);
}

/** Process queued integration actions that are due now. Mirrors the heal sweeper. */
export async function sweepIntegrationActions(
  db: DbClient,
): Promise<{ done: number; failed: number; skipped: number }> {
  const now = new Date();
  let done = 0;
  let failed = 0;
  let skipped = 0;

  const due = await db
    .select()
    .from(integrationActions)
    .where(
      and(
        eq(integrationActions.status, 'pending'),
        lte(integrationActions.scheduledFor, now),
        lt(integrationActions.attempts, OUTBOX_MAX_ATTEMPTS),
      ),
    );

  for (const action of due) {
    const outcome = await runAction(db, action);
    if (outcome.status === 'done') done++;
    else if (outcome.status === 'skipped') skipped++;
    else failed++;
  }

  return { done, failed, skipped };
}
