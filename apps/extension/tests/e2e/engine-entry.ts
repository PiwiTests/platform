import { parseLocatorChain } from '@piwitests/core/locator-chain';
import { createLocatorEngine } from '../../src/content/locator-engine.js';
import { DomModel } from '../../src/content/engine-aria.js';
import { buildOutline } from '../../src/content/bug-outline.js';

interface EngineResult {
  ids?: Array<string | null>;
  error?: string;
}

/**
 * Test-only entry: evaluates many locator expressions with one engine (one
 * evaluation pass, shared caches and prefixes, as the coverage overlay runs
 * it) and answers each with the `data-eid` of the elements found; `strict`
 * resolves frame owners as an action does.
 */
(globalThis as unknown as Record<string, unknown>).__piwiEngineQueryAll = (
  expressions: string[],
  testIdAttributes?: string[],
  strict?: boolean,
): EngineResult[] => {
  const engine = createLocatorEngine(document, { testIdAttributes, strict });
  return expressions.map((expression) => {
    try {
      return { ids: engine.queryAll(parseLocatorChain(expression)).map((element) => element.getAttribute('data-eid')) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });
};

/** Test-only: the bug report's outline of the element matching `selector`, or of the body. */
(globalThis as unknown as Record<string, unknown>).__piwiBuildOutline = (
  selector?: string,
  maxLines?: number,
): string => buildOutline(selector ? document.querySelector(selector)! : document.body, { maxLines });

/** Test-only: the accessible name Playwright computes for an element, as the tools name it. */
(globalThis as unknown as Record<string, unknown>).__piwiAccessibleName = (element: Element): string | null =>
  new DomModel().normalizedAccessibleName(element, false) || null;
