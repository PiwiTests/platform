import { z } from 'zod';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { mintShareLink, resolveShareLinkMaxTtlDays, shareLinksEnabled } from '../../../utils/share-links';
import { resolvePublicBaseUrl } from '../../../utils/oauth-helpers';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Create a share link for one execution',
    description:
      'Mints a read-only public link for this execution. The full token is returned once and stored only as a hash. Requires PIWI_SHARE_LINKS_ENABLED=true.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const bodySchema = z.object({ ttlDays: z.number().int().min(1).max(3650).nullish() });

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db, projectId, user } = await requireResolvedProjectAccess(
    event,
    id,
    resolveTestRunCaseProjectId,
    'Test run case',
  );

  if (!shareLinksEnabled()) {
    throw apiError({
      statusCode: 403,
      message: 'Share links are disabled. Set PIWI_SHARE_LINKS_ENABLED=true to allow them.',
    });
  }

  const validation = bodySchema.safeParse((await readBody(event).catch(() => null)) ?? {});
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  const minted = await mintShareLink(db, {
    projectId,
    entityKind: 'execution',
    entityId: id,
    createdBy: user.id || null,
    ttlDays: validation.data.ttlDays,
  });

  const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
  const requestUrl = getRequestURL(event);
  const base = resolvePublicBaseUrl(siteUrl, `${requestUrl.protocol}//${requestUrl.host}`);

  return {
    token: minted.token,
    url: `${base}/share/${minted.token}`,
    maxTtlDays: resolveShareLinkMaxTtlDays(),
    link: {
      id: minted.link.id,
      tokenPrefix: minted.link.tokenPrefix,
      expiresAt: minted.link.expiresAt,
      createdAt: minted.link.createdAt,
    },
  };
});
