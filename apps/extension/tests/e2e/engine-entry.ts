import { parseLocatorChain } from '@piwitests/core/locator-chain';
import { createLocatorEngine } from '../../src/content/locator-engine.js';

interface EngineResult {
  ids?: Array<string | null>;
  error?: string;
}

/**
 * Test-only entry: evaluates many locator expressions with one engine (one
 * evaluation pass, shared caches and prefixes, as the coverage overlay runs
 * it) and answers each with the `data-eid` of the elements found.
 */
(globalThis as unknown as Record<string, unknown>).__piwiEngineQueryAll = (
  expressions: string[],
  testIdAttributes?: string[],
): EngineResult[] => {
  const engine = createLocatorEngine(document, { testIdAttributes });
  return expressions.map((expression) => {
    try {
      return { ids: engine.queryAll(parseLocatorChain(expression)).map((element) => element.getAttribute('data-eid')) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
};
