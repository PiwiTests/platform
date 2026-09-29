import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { resolveCiCost } from '#shared/handlers/ci-cost';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get the cost of a CI minute',
    description:
      'Returns the cost of one CI minute (amount and ISO 4217 currency) that turns wasted CI minutes into money in the analytics widgets and quality reports, or null when none is set, and whether PIWI_CI_MINUTE_COST pins it. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return resolveCiCost(await getDatabase());
});
