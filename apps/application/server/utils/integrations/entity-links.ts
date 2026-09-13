/**
 * Entity-link writes the integration layer owns: recording the link Piwi creates
 * when it files an issue, and refreshing a link's status fields when the sync
 * task reads the tracker back. Kept apart from `shared/handlers/links.ts` (which
 * serves the user-pinned link CRUD) because these rows carry a `connection_id`
 * and an `origin` a person never sets by hand.
 */
import { eq } from 'drizzle-orm';
import { entityLinks } from '../../database/schema';
import type { DbClient } from '../../database';
import type { LinkEntityType } from '#shared/handlers/links';

/** The `entity_links` insert field for the given entity type. */
function fkFieldFor(entityType: LinkEntityType, entityId: number): Record<string, number> {
  switch (entityType) {
    case 'test_run':
      return { testRunId: entityId };
    case 'test_runs_case':
      return { testRunsCaseId: entityId };
    case 'failure_cluster':
      return { failureClusterId: entityId };
    default:
      return { testCaseId: entityId };
  }
}

export interface CreatedIssueLink {
  provider: string;
  url: string;
  key: string | null;
  externalId: string | null;
  title: string | null;
  statusText: string | null;
  statusColor: string | null;
}

/**
 * Record the link to an issue Piwi just created. `origin: 'created'` distinguishes
 * it from a link a person pinned, so the sync task knows it can write back through
 * the connection. Runs inside the caller's transaction so the row and the action
 * result commit together.
 */
export async function writeCreatedIssueLink(
  db: DbClient,
  input: {
    entityType: LinkEntityType;
    entityId: number;
    connectionId: number;
    createdBy: number | null;
    issue: CreatedIssueLink;
  },
): Promise<{ id: number } | null> {
  const [row] = await db
    .insert(entityLinks)
    .values({
      ...fkFieldFor(input.entityType, input.entityId),
      url: input.issue.url,
      provider: input.issue.provider,
      key: input.issue.key,
      title: input.issue.title,
      statusText: input.issue.statusText,
      statusColor: input.issue.statusColor,
      connectionId: input.connectionId,
      externalId: input.issue.externalId,
      origin: 'created',
      createdBy: input.createdBy,
      unfurledAt: new Date(),
    })
    .returning({ id: entityLinks.id });
  return row ?? null;
}

/**
 * Merge a patch into a link's `metadata` JSON, preserving the keys it already
 * carries. The sync task and the still-failing policy keep their bookkeeping
 * (the tracker's status category and assignee, the last-commented occurrence
 * count) here.
 */
export async function mergeEntityLinkMetadata(db: DbClient, id: number, patch: Record<string, unknown>): Promise<void> {
  const [row] = await db.select({ metadata: entityLinks.metadata }).from(entityLinks).where(eq(entityLinks.id, id));
  const current = (row?.metadata as Record<string, unknown> | null) ?? {};
  await db
    .update(entityLinks)
    .set({ metadata: { ...current, ...patch } as never, updatedAt: new Date() })
    .where(eq(entityLinks.id, id));
}

/**
 * Refresh an entity link's cached status fields — what the sync milestone calls
 * after reading the tracker back through the connection.
 */
export async function updateEntityLinkStatus(
  db: DbClient,
  id: number,
  fields: {
    title?: string | null;
    statusText?: string | null;
    statusColor?: string | null;
    key?: string | null;
  },
): Promise<void> {
  await db
    .update(entityLinks)
    .set({ ...fields, unfurledAt: new Date(), updatedAt: new Date() })
    .where(eq(entityLinks.id, id));
}
