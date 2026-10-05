import { z } from 'zod';
import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { isIntegrationProvider } from '#shared/integrations/registry';
import { normalizeJiraSiteUrl } from '#shared/integrations/jira-setup';
import type { ConnectionCheckResult } from '#shared/integrations/types';
import { credentialsForCheck } from '../../../utils/integrations/connections';
import { checkJiraCredentials, probeJiraSite } from '../../../utils/integrations/jira/check';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Check a connection before saving it',
    description:
      'Reads the typed address down to the Jira site URL, checks it is a Jira Cloud site through its public `serverInfo` (and resolves its cloud id), then — when credentials are supplied — signs in, reports whether the token is classic or scoped, and counts the projects the account sees. Nothing is stored. When `connectionId` names the connection being edited and a credential field is blank, the stored value is used, but only while the site stays the same. Each step carries a plain-language `hint` when it fails.',
    'x-required-permission': 'connections:manage',
  },
});

const schema = z.object({
  provider: z.string().refine(isIntegrationProvider, 'Unknown provider'),
  baseUrl: z.string().min(1).max(2000),
  credentials: z.record(z.string(), z.string()).nullable().optional(),
  connectionId: z.number().int().positive().nullable().optional(),
});

export default eventHandler(async (event): Promise<ConnectionCheckResult> => {
  await requireAuth(event);
  const parsed = schema.safeParse(await readBody(event));
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const site = normalizeJiraSiteUrl(parsed.data.baseUrl);
  if (!site) {
    throw apiError({ statusCode: 400, message: 'Enter the site address, e.g. https://your-team.atlassian.net' });
  }

  const result: ConnectionCheckResult = { baseUrl: site.url, site: await probeJiraSite(site.url) };
  // An unreachable address answers nothing more with credentials; skip the second wait.
  if (!result.site.reachable) return result;

  const db = await getDatabase();
  const credentials = await credentialsForCheck(db, {
    siteUrl: site.url,
    credentials: parsed.data.credentials,
    connectionId: parsed.data.connectionId,
  });
  if (!credentials) return result;
  return { ...result, ...(await checkJiraCredentials(site.url, credentials)) };
});
