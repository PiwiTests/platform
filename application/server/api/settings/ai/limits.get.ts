import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { Role } from '../../../../shared/types';
import { resolveContextLimits, envManagedLimitKeys } from '../../../utils/ai-context-limits';
import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS } from '#shared/ai-context-limits';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI context limits',
    description:
      'Returns the effective AI diagnosis context limits (defaults ← stored settings ← env vars), their defaults, the keys pinned by environment variables, and field metadata. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const db = await getDatabase();
  return {
    limits: await resolveContextLimits(db),
    defaults: DEFAULT_CONTEXT_LIMITS,
    envManaged: envManagedLimitKeys(),
    fields: CONTEXT_LIMIT_FIELDS,
  };
});
