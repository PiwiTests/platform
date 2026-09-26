import { deleteAppSetting, getAppSetting, setAppSetting } from '../../server/utils/app-settings';
import { CI_COST_SETTING_KEY, coerceCiCost, parseCiCost, type ResolvedCiCost } from '../ci-cost';
import type { DrizzleDB } from './db';

/**
 * The effective cost of a CI minute: `PIWI_CI_MINUTE_COST` when set (it locks
 * the setting), else the stored `ci_cost` app setting, else none. The demo has
 * no environment, so it reads the stored setting only.
 */
export async function resolveCiCost(db: DrizzleDB): Promise<ResolvedCiCost> {
  const env = typeof process !== 'undefined' ? process.env?.PIWI_CI_MINUTE_COST : undefined;
  if (env && env.trim()) return { cost: parseCiCost(env), envManaged: true };
  return { cost: coerceCiCost(await getAppSetting(db, CI_COST_SETTING_KEY)), envManaged: false };
}

export class CiCostError extends Error {
  constructor(
    readonly statusCode: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Store or clear the cost of a CI minute: `{ cost: { amount, currency } }`
 * sets it, `{ cost: null }` clears it. Refused while the env var pins it.
 */
export async function saveCiCost(db: DrizzleDB, body: { cost?: unknown }): Promise<ResolvedCiCost> {
  const current = await resolveCiCost(db);
  if (current.envManaged) {
    throw new CiCostError(409, 'The cost of a CI minute is managed by the PIWI_CI_MINUTE_COST environment variable');
  }
  if (body.cost === null) {
    await deleteAppSetting(db, CI_COST_SETTING_KEY);
  } else {
    const cost = coerceCiCost(body.cost);
    if (!cost) throw new CiCostError(400, 'A cost needs a positive amount and a three-letter currency code');
    await setAppSetting(db, CI_COST_SETTING_KEY, cost);
  }
  return resolveCiCost(db);
}
