import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';
import { readAiSettings } from '../../utils/ai-settings';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI settings',
    description:
      'Returns full AI configuration: per-role provider settings (diagnosis, research, embedding), API key presence, auto-diagnose toggle, custom instructions, and SCM token presence. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const db = await getDatabase();
  return readAiSettings(db);
});
