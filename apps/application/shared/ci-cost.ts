/**
 * The cost of a CI minute: one instance-level amount and currency that turns
 * wasted CI minutes into money. Stored as the `ci_cost` app setting, pinned by
 * `PIWI_CI_MINUTE_COST` (`"0.008 USD"`) when that is set. Unset, every surface
 * shows minutes only.
 */

export const CI_COST_SETTING_KEY = 'ci_cost';

export interface CiCost {
  /** Cost of one CI minute, in `currency`. */
  amount: number;
  /** ISO 4217 code, upper case. */
  currency: string;
}

export interface ResolvedCiCost {
  cost: CiCost | null;
  /** True when `PIWI_CI_MINUTE_COST` pins the value (the setting is read-only). */
  envManaged: boolean;
}

const CURRENCY = /^[A-Z]{3}$/;

/** A cost object when the amount is a positive finite number and the currency an ISO code. */
export function coerceCiCost(value: unknown): CiCost | null {
  if (!value || typeof value !== 'object') return null;
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || !CURRENCY.test(code)) return null;
  return { amount: n, currency: code };
}

/** Parse the env form `"0.008 USD"` (the currency may come first too: `"USD 0.008"`). */
export function parseCiCost(raw: string | undefined | null): CiCost | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  return Number.isFinite(Number(a))
    ? coerceCiCost({ amount: a, currency: b })
    : coerceCiCost({ amount: b, currency: a });
}

/** Wasted minutes as money, rounded to cents. */
export function costOfMinutes(minutes: number, cost: CiCost): number {
  return Math.round(minutes * cost.amount * 100) / 100;
}

/** Format an amount of money in the locale (`$1,234.50`, `1 234,50 €`). */
export function formatMoney(amount: number, currency: string, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
