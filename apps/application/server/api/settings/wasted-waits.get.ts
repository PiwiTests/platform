import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { resolveWastedSettings } from '../../utils/wasted-settings';
import { DEFAULT_WASTED_WAIT_PATTERNS } from '#shared/utils/wasted-waits';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get wasted-time settings',
    description:
      'Returns the allowlist of glob patterns that classify wait steps as wasted time, whether it is managed by the PIWI_WASTED_WAIT_PATTERNS environment variable, and the built-in defaults. Patterns match a wait step title or its source location. Requires `settings:manage` (administrators only).',
    'x-required-permission': 'settings:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  const resolved = await resolveWastedSettings(db);
  return { ...resolved, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
});
