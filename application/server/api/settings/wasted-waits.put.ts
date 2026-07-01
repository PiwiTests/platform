import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { Role } from '#shared/types';
import { setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { resolveWastedSettings, WASTED_WAIT_PATTERNS_KEY } from '../../utils/wasted-settings';
import { parseWastedWaitPatterns, DEFAULT_WASTED_WAIT_PATTERNS } from '#shared/utils/wasted-waits';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save wasted-time settings',
    description:
      'Updates the allowlist of glob patterns used to classify wait steps as wasted time. Send `patterns: null` to reset to the built-in defaults. Wasted time is recomputed at read time, so changes apply to historical runs immediately. Not available when managed via PIWI_WASTED_WAIT_PATTERNS. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const db = await getDatabase();

  const runtimeConfig = useRuntimeConfig();
  if ((runtimeConfig.wastedWaitPatterns as string | undefined)?.trim()) {
    throw createError({
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
