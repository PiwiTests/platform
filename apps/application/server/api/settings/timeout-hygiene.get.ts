import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getTimeoutThresholds } from '../../utils/timeout-thresholds';
import { DEFAULT_TIMEOUT_THRESHOLDS } from '#shared/analytics/timeout-hygiene';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get timeout-hygiene thresholds',
    description:
      'Returns the thresholds used to flag oversized per-test timeouts and stale test.slow() marks, plus the built-in defaults. Requires `settings:manage` (administrators only).',
    'x-required-permission': 'settings:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  const thresholds = await getTimeoutThresholds(db);
  return { thresholds, defaults: DEFAULT_TIMEOUT_THRESHOLDS };
});
