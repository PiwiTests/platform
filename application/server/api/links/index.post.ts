import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { entityLinks } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { createLink } from '#shared/handlers/links';
import { z } from 'zod';
import { Role } from '#shared/types';
import { unfurlUrl } from '../../utils/unfurl';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'Create an entity link',
    description:
      'Attach an external URL to a run, test-case run, or test case. Provider is auto-detected from the URL.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const createLinkSchema = z.object({
  entityType: z.enum(['test_run', 'test_runs_case', 'test_case']),
  entityId: z.number().int().positive(),
  url: z.string().url('Must be a valid URL'),
  title: z.string().max(200).nullable().optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const body = await readBody(event);
  const validation = createLinkSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const { entityType, entityId, url, title } = validation.data;
  const db = await getDatabase();

  let result: { link: any };
  try {
    result = await createLink(db, { entityType, entityId, url, title });
  } catch (err) {
    throw createError({
      statusCode: 404,
      message: err instanceof Error ? err.message : 'Failed to create link',
    });
  }

  const inserted = result.link;
  if (!inserted) {
    throw createError({ statusCode: 500, message: 'Failed to create link' });
  }

  // Best-effort unfurl (server-only enrichment) — tries rich provider first, falls back to OpenGraph
  const { title: fetchedTitle, statusText, statusColor } = await unfurlUrl(url, db);
  if (fetchedTitle || statusText) {
    await db
      .update(entityLinks)
      .set({
        title: fetchedTitle ?? inserted.title,
        statusText: statusText ?? null,
        statusColor: statusColor ?? null,
        unfurledAt: new Date(),
      })
      .where(eq(entityLinks.id, inserted.id));
    const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, inserted.id));
    return { link: updated[0] };
  }

  return { link: inserted };
});
