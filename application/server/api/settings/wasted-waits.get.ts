import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { resolveWastedSettings } from '../../utils/wasted-settings';
import { DEFAULT_WASTED_WAIT_PATTERNS } from '../../../shared/utils/wasted-waits';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get wasted-time settings',
    description:
      'Returns the allowlist of glob patterns that classify wait steps as wasted time, whether it is managed by the PIWI_WASTED_WAIT_PATTERNS environment variable, and the built-in defaults. Patterns match a wait step title or its source location. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const db = await getDatabase();
  const resolved = await resolveWastedSettings(db);
  return { ...resolved, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
});
