import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { resolveWastedSettings } from '../../utils/wasted-settings';
import {
  parseWastedWaitPatterns,
  DEFAULT_WASTED_WAIT_PATTERNS,
  WASTED_WAIT_PATTERNS_KEY,
} from '#shared/utils/wasted-waits';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save wasted-time settings',
    description:
      'Updates the allowlist of glob patterns used to classify wait steps as wasted time. Send `patterns: null` to reset to the built-in defaults. Wasted time is recomputed at read time, so changes apply to historical runs immediately. Env-managed conflict: when patterns are supplied via PIWI_WASTED_WAIT_PATTERNS the environment is authoritative for the whole setting and any write is refused with HTTP 409. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const runtimeConfig = useRuntimeConfig();
  if ((runtimeConfig.wastedWaitPatterns as string | undefined)?.trim()) {
    throw apiError({
      statusCode: 409,
      message: 'Wasted-time patterns are managed by the PIWI_WASTED_WAIT_PATTERNS environment variable',
    });
  }

  const body = (await readBody(event)) as { patterns?: string[] | string | null };

  if (body.patterns === null) {
    // Reset to defaults.
    await deleteAppSetting(db, WASTED_WAIT_PATTERNS_KEY);
  } else {
    const patterns = parseWastedWaitPatterns(body.patterns);
    await setAppSetting(db, WASTED_WAIT_PATTERNS_KEY, { value: patterns });
  }

  const resolved = await resolveWastedSettings(db);
  return { ...resolved, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
});
