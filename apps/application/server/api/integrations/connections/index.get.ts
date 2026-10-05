import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { listConnections } from '../../../utils/integrations/connections';
import { canEncryptSecrets } from '../../../utils/crypto';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'List integration connections',
    description:
      'Lists every configured integration connection. Credentials are never returned. `canStoreSecrets` is false when `PIWI_SECRET_KEY` is unset, in which case a new connection cannot store its token (configure it through the environment instead).',
    'x-required-permission': 'connections:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return { connections: await listConnections(db), canStoreSecrets: canEncryptSecrets() };
});
