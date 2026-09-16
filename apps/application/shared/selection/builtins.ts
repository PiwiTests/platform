/**
 * Built-in selections that exist implicitly for every project with no setup.
 * They make `piwi run` useful on day one and double as living documentation of
 * the definition format. Their keys are reserved — a saved selection may not
 * claim one.
 */
import type { SelectionDefinition } from './types';

export interface BuiltinSelection {
  key: string;
  name: string;
  description: string;
  definition: SelectionDefinition;
}

export const BUILTIN_SELECTIONS: BuiltinSelection[] = [
  {
    key: 'failed',
    name: 'Currently failing',
    description: 'Tests whose most recent execution failed or timed out.',
    definition: { include: [{ lastStatus: ['failed', 'timedout', 'timedOut'] }] },
  },
  {
    key: 'quarantine-free',
    name: 'Everything but quarantine',
    description: 'The whole suite minus tests under an active quarantine.',
    definition: { exclude: [{ quarantined: true }] },
  },
];

const BUILTIN_BY_KEY = new Map(BUILTIN_SELECTIONS.map((s) => [s.key, s]));

export function isBuiltinKey(key: string): boolean {
  return BUILTIN_BY_KEY.has(key);
}

export function getBuiltinSelection(key: string): BuiltinSelection | undefined {
  return BUILTIN_BY_KEY.get(key);
}
