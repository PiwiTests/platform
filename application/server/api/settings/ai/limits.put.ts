import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { Role } from '#shared/types';
import { getAppSetting, setAppSetting } from '../../../utils/app-settings';
import {
  resolveContextLimits,
  envManagedLimitKeys,
  CONTEXT_LIMITS_SETTING_KEY,
} from '../../../utils/ai-context-limits';
import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS, clampLimit } from '#shared/ai-context-limits';
import type { ContextLimits } from '#shared/ai-context-limits';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save AI context limits',
    description:
      'Persists overrides for the AI diagnosis context limits. Values are clamped to each field range; an empty/null value resets a field to its default. Fields pinned by environment variables are ignored. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const body = (await readBody(event).catch(() => null)) as {
    limits?: Partial<Record<keyof ContextLimits, unknown>>;
  } | null;
  const incoming = body?.limits ?? {};

  const db = await getDatabase();
  const stored = (await getAppSetting<Partial<ContextLimits>>(db, CONTEXT_LIMITS_SETTING_KEY)) ?? {};
  const envManaged = new Set(envManagedLimitKeys());

  const next: Partial<ContextLimits> = { ...stored };
  for (const field of CONTEXT_LIMIT_FIELDS) {
    if (envManaged.has(field.key)) continue; // env overrides; never persist these
    if (!(field.key in incoming)) continue;
    const raw = incoming[field.key];
    if (raw === null || raw === undefined || raw === '') {
      delete next[field.key]; // reset to default
      continue;
    }
    const clamped = clampLimit(field, raw);
    if (clamped != null) next[field.key] = clamped;
  }

  await setAppSetting(db, CONTEXT_LIMITS_SETTING_KEY, next);

  return {
    limits: await resolveContextLimits(db),
    defaults: DEFAULT_CONTEXT_LIMITS,
    envManaged: [...envManaged],
    fields: CONTEXT_LIMIT_FIELDS,
  };
});
