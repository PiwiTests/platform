import { z } from 'zod';
import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { canAccessProject, resolveLinkEntityProjectId } from '../../utils/project-access';
import { createIssue } from '../../utils/integrations/create';
import { Role } from '#shared/types';
import type { CreateIssueResponse } from '#shared/integrations/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Create an issue from a failure',
    description: 'Enqueues a create-issue action and makes one immediate attempt. A duplicate is a no-op.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const schema = z.object({
  entityType: z.enum(['failure_cluster', 'test_runs_case']),
  entityId: z.number().int().positive(),
  connectionId: z.number().int().positive(),
  title: z.string().min(1).max(255),
  projectKey: z.string().min(1).max(100),
  issueType: z.string().min(1).max(100),
  labels: z.array(z.string()).optional(),
  assignee: z.string().nullable().optional(),
  locale: z.enum(['en', 'fr']).optional(),
  include: z
    .object({
      includeDiagnosis: z.boolean().optional(),
      includePatch: z.boolean().optional(),
      includeScreenshot: z.boolean().optional(),
      includeShareLink: z.boolean().optional(),
    })
    .optional(),
});

export default eventHandler(async (event): Promise<CreateIssueResponse> => {
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }
  const input = parsed.data;

  // The role gate comes before the entity lookup, so a member outside the
  // allowed roles learns nothing about which cluster or execution ids exist.
  const user = await requireAuth(event, [Role.ADMINISTRATOR, Role.REPORTER]);
  const db = await getDatabase();
  const projectId = await resolveLinkEntityProjectId(db, input.entityType, input.entityId);
  if (!projectId) throw apiError({ statusCode: 404, message: 'Entity not found' });
  if (!(await canAccessProject(db, user, projectId))) {
    throw apiError({ statusCode: 403, message: 'No access to this project' });
  }

  const outcome = await createIssue(db, {
    entityType: input.entityType,
    entityId: input.entityId,
    connectionId: input.connectionId,
    title: input.title,
    projectKey: input.projectKey,
    issueType: input.issueType,
    labels: input.labels,
    assignee: input.assignee ?? null,
    locale: input.locale,
    include: input.include,
    requestedBy: user.id || null,
    siteUrl: process.env.PIWI_SITE_URL ?? null,
  });
  if (!outcome) throw apiError({ statusCode: 404, message: 'Entity or cluster unavailable' });

  return {
    actionId: outcome.actionId,
    status: outcome.status,
    key: outcome.key,
    url: outcome.url,
    error: outcome.error,
  };
});
