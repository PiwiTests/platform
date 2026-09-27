import type { Locator, Page } from '@playwright/test';
import { parseLocatorChain, type LocatorArg, type LocatorChain } from '@piwitests/core/locator-chain';

function argValue(page: Page, arg: LocatorArg): unknown {
  switch (arg.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return arg.value;
    case 'regex':
      return new RegExp(arg.source, arg.flags);
    case 'object':
      return Object.fromEntries(arg.entries.map(([key, value]) => [key, argValue(page, value)]));
    case 'chain':
      return playwrightLocator(page, arg.chain);
  }
}

/** The chain rebuilt with the real Playwright API: each call name is the method of the same name. */
export function playwrightLocator(page: Page, chain: LocatorChain | string): Locator {
  let current: unknown = page;
  for (const call of (typeof chain === 'string' ? parseLocatorChain(chain) : chain).calls) {
    const args = call.args.map((arg) => argValue(page, arg));
    const target = current as Record<string, (...a: unknown[]) => unknown>;
    current = target[call.method]!(...args);
  }
  return current as Locator;
}
