import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { CiCostError, saveCiCost } from '#shared/handlers/ci-cost';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save the cost of a CI minute',
    description:
      'Sets the cost of one CI minute with `{ "cost": { "amount": 0.008, "currency": "USD" } }`, or clears it with `{ "cost": null }`. Refused with HTTP 409 while PIWI_CI_MINUTE_COST pins the value. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const body = ((await readBody(event)) ?? {}) as { cost?: unknown };
  try {
    return await saveCiCost(await getDatabase(), body);
  } catch (error) {
    if (error instanceof CiCostError) throw apiError({ statusCode: error.statusCode, message: error.message });
    throw error;
  }
});
