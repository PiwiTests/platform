import { getDatabase } from '../../database';
import { apiError } from '../../utils/api-error';
import { requireAuth } from '../../utils/auth';
import { canAccessProject, resolveLinkEntityProjectId } from '../../utils/project-access';
import { buildIssueDraft, type DraftEntityType } from '../../utils/integrations/draft';
import { Role } from '#shared/types';
import { toIssueLocale } from '#shared/integrations/messages';
import type { IssueIncludeOptions } from '#shared/integrations/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Prefilled create-issue draft',
    description:
      'The prefilled draft for a failure — title, fields, body preview — plus any issue that already tracks it.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const DRAFT_ENTITY_TYPES: DraftEntityType[] = ['failure_cluster', 'test_runs_case'];

function boolQuery(value: unknown): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

export default eventHandler(async (event) => {
  const query = getQuery(event);
  const entityType = String(query.entityType ?? '') as DraftEntityType;
  const entityId = Number(query.entityId ?? 0);
  if (!DRAFT_ENTITY_TYPES.includes(entityType) || !Number.isInteger(entityId) || entityId <= 0) {
    throw apiError({ statusCode: 400, message: 'entityType and entityId are required' });
  }

  // The role gate comes before the entity lookup, so a member outside the
  // allowed roles learns nothing about which cluster or execution ids exist.
  const user = await requireAuth(event, [Role.ADMINISTRATOR, Role.REPORTER]);
  const db = await getDatabase();
  const projectId = await resolveLinkEntityProjectId(db, entityType, entityId);
  if (!projectId) throw apiError({ statusCode: 404, message: 'Entity not found' });
  if (!(await canAccessProject(db, user, projectId))) {
    throw apiError({ statusCode: 403, message: 'No access to this project' });
  }

  const includeOverride: Partial<IssueIncludeOptions> = {};
  const diagnosis = boolQuery(query.includeDiagnosis);
  const patch = boolQuery(query.includePatch);
  const screenshot = boolQuery(query.includeScreenshot);
  const shareLink = boolQuery(query.includeShareLink);
  if (diagnosis !== undefined) includeOverride.includeDiagnosis = diagnosis;
  if (patch !== undefined) includeOverride.includePatch = patch;
  if (screenshot !== undefined) includeOverride.includeScreenshot = screenshot;
  if (shareLink !== undefined) includeOverride.includeShareLink = shareLink;

  const connectionId = query.connectionId ? Number(query.connectionId) : undefined;

  const draft = await buildIssueDraft(db, entityType, entityId, {
    connectionId: connectionId && Number.isInteger(connectionId) ? connectionId : undefined,
    include: includeOverride,
    locale: toIssueLocale(query.locale),
    siteUrl: process.env.PIWI_SITE_URL ?? null,
  });
  if (!draft) throw apiError({ statusCode: 404, message: 'No tracker connected or entity unavailable' });
  return draft;
});
