import { z } from 'zod';
import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { isIntegrationProvider } from '#shared/integrations/registry';
import { createConnection } from '../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Create an integration connection',
    description: 'Creates an integration connection. Credentials are encrypted at rest and never returned.',
    'x-required-roles': ['administrator'],
  },
});

const schema = z.object({
  provider: z.string().refine(isIntegrationProvider, 'Unknown provider'),
  name: z.string().min(1).max(200),
  baseUrl: z.string().url('Must be a valid URL'),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  credentials: z.record(z.string(), z.string()).nullable().optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  const connection = await createConnection(db, {
    provider: parsed.data.provider,
    name: parsed.data.name,
    baseUrl: parsed.data.baseUrl,
    config: parsed.data.config ?? null,
    credentials: parsed.data.credentials ?? null,
  });
  return { connection };
});
