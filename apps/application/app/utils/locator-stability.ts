/** What the Locators page lists: every chain, or only the brittle or watched ones. */
export type LocatorStabilityFilter = 'all' | 'brittle' | 'watch';

const FILTERS: readonly LocatorStabilityFilter[] = ['all', 'brittle', 'watch'];

/** The stability filter a `?stability=` query asks for; every chain when absent or unknown. */
export function parseLocatorStabilityFilter(value: unknown): LocatorStabilityFilter {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value)
    ? (value as LocatorStabilityFilter)
    : 'all';
}
