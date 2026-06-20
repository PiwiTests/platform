import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { entityLinks, testRuns, testRunsCases, testCases } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Role } from '../../../shared/types';
import { detectProvider, extractKey } from '../../../shared/link-detect';
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

  // Validate the referenced entity exists
  let exists = false;
  if (entityType === 'test_run') {
    const row = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, entityId));
    exists = row.length > 0;
  } else if (entityType === 'test_runs_case') {
    const row = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, entityId));
    exists = row.length > 0;
  } else {
    const row = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, entityId));
    exists = row.length > 0;
  }

  if (!exists) {
    throw createError({ statusCode: 404, message: `${entityType} not found` });
  }

  // Detect provider and key from URL
  const provider = detectProvider(url);
  const key = extractKey(url, provider);

  const fkColumn =
    entityType === 'test_run'
      ? { testRunId: entityId }
      : entityType === 'test_runs_case'
        ? { testRunsCaseId: entityId }
        : { testCaseId: entityId };

  const result = await db
    .insert(entityLinks)
    .values({
      ...fkColumn,
      url,
      provider,
      key,
      title: title ?? null,
    })
    .returning();

  const inserted = result[0]!;

  // Best-effort unfurl
  const { title: fetchedTitle, statusText, statusColor } = await unfurlUrl(url);
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
