import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getAppSetting, setAppSetting } from '../../../utils/app-settings';
import { resolveContextLimits, envManagedLimitKeys } from '../../../utils/ai-context-limits';
import {
  CONTEXT_LIMIT_FIELDS,
  DEFAULT_CONTEXT_LIMITS,
  CONTEXT_LIMITS_SETTING_KEY,
  mergeContextLimitsUpdate,
} from '#shared/ai-context-limits';
import type { ContextLimits } from '#shared/ai-context-limits';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save AI context limits',
    description:
      'Persists overrides for the AI diagnosis context limits. Values are clamped to each field range; an empty/null value resets a field to its default. Fields pinned by environment variables are ignored. Requires `settings:manage` (administrators only).',
    'x-required-permission': 'settings:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const body = (await readBody(event).catch(() => null)) as {
    limits?: Partial<Record<keyof ContextLimits, unknown>>;
  } | null;
  const incoming = body?.limits ?? {};

  const db = await getDatabase();
  const stored = await getAppSetting<Partial<ContextLimits>>(db, CONTEXT_LIMITS_SETTING_KEY);
  const envManaged = new Set(envManagedLimitKeys());
  const next = mergeContextLimitsUpdate(stored, incoming, envManaged);

  await setAppSetting(db, CONTEXT_LIMITS_SETTING_KEY, next);

  return {
    limits: await resolveContextLimits(db),
    defaults: DEFAULT_CONTEXT_LIMITS,
    envManaged: [...envManaged],
    fields: CONTEXT_LIMIT_FIELDS,
  };
});
