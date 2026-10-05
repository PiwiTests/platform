import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { getTimeoutThresholds } from '../../utils/timeout-thresholds';
import {
  DEFAULT_TIMEOUT_THRESHOLDS,
  TIMEOUT_THRESHOLDS_KEY,
  resolveTimeoutThresholds,
  type TimeoutThresholds,
} from '#shared/analytics/timeout-hygiene';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save timeout-hygiene thresholds',
    description:
      'Updates the thresholds used to flag oversized per-test timeouts and stale test.slow() marks. Send `thresholds: null` to reset to the built-in defaults. Opportunities are recomputed at read time, so changes apply to historical runs immediately. Requires `settings:manage` (administrators only).',
    'x-required-permission': 'settings:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const body = (await readBody(event)) as { thresholds?: Partial<TimeoutThresholds> | null };

  if (body.thresholds === null) {
    await deleteAppSetting(db, TIMEOUT_THRESHOLDS_KEY);
  } else {
    // Persist the fully-merged, sanitised object so a partial/invalid payload
    // can never leave detection in a broken state.
    await setAppSetting(db, TIMEOUT_THRESHOLDS_KEY, resolveTimeoutThresholds(body.thresholds));
  }

  const thresholds = await getTimeoutThresholds(db);
  return { thresholds, defaults: DEFAULT_TIMEOUT_THRESHOLDS };
});
