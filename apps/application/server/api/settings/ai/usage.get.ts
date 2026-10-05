import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getAiUsageSummary } from '#shared/handlers/ai-usage';
import type { AiUsageSummary } from '~~/types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI token usage',
    description:
      'Aggregates AI diagnosis token usage over the requested period, grouped by provider and model. Each diagnosis version counts once: the current one by when it started, earlier ones by when they were replaced. Requires `settings:manage` (administrators only).',
    parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30, minimum: 1, maximum: 365 } }],
    'x-required-permission': 'settings:manage',
  },
});

export default eventHandler(async (event): Promise<AiUsageSummary> => {
  await requireAuth(event);

  const days = optionalIntQuery(event, 'days', { default: 30, min: 1, max: 365 });
  return getAiUsageSummary(await getDatabase(), days);
});
