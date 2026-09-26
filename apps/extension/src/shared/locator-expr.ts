/**
 * The locator expressions this extension reads back, parsed with the shared
 * `@piwitests/core` parser (no `eval`, no `Function` construction from user
 * input) and narrowed to the chain shapes the in-page evaluator supports:
 * `getBy*` leaf calls, `locator(css)`, and the narrowing chain methods
 * `filter({ hasText })`, `first()`, `last()`, `nth(n)`.
 */
import {
  LOCATING_METHODS,
  LocatorParseError,
  parseLocatorChain,
  type LocatorArg,
  type LocatorCall as CoreLocatorCall,
} from '@piwitests/core/locator-chain';

export type LocatorCall =
  | { method: 'getByRole'; role: string; name?: string; exact?: boolean; level?: number }
  | {
      method: 'getByTestId' | 'getByText' | 'getByLabel' | 'getByPlaceholder' | 'getByAltText' | 'getByTitle';
      text: string;
      exact?: boolean;
    }
  | { method: 'locator'; selector: string }
  | { method: 'filter'; hasText?: string; hasNotText?: string }
  | { method: 'first' | 'last' }
  | { method: 'nth'; index: number };

export interface ParsedLocatorChain {
  calls: LocatorCall[];
}

/** Methods this extension evaluates, in the order the error message lists them. */
const SUPPORTED = new Set([
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'locator',
  'filter',
  'first',
  'last',
  'nth',
]);

function stringArg(arg: LocatorArg | undefined, what: string): string {
  if (arg?.type === 'string') return arg.value;
  if (arg?.type === 'regex') throw new Error(`${what}: regular expressions aren't supported here yet`);
  throw new Error(`${what}: expected a string literal`);
}

/** The option values of an object argument, by key. */
function options(arg: LocatorArg | undefined): Map<string, LocatorArg> {
  return new Map(arg?.type === 'object' ? arg.entries : []);
}

function optString(opts: Map<string, LocatorArg>, key: string, what: string): { [k: string]: string } {
  const value = opts.get(key);
  return value === undefined ? {} : { [key]: stringArg(value, `${what} ${key}`) };
}

function optBoolean(opts: Map<string, LocatorArg>, key: string): { [k: string]: boolean } {
  const value = opts.get(key);
  return value?.type === 'boolean' ? { [key]: value.value } : {};
}

function toExtensionCall(call: CoreLocatorCall): LocatorCall {
  const what = `${call.method}()`;
  switch (call.method) {
    case 'getByRole': {
      const opts = options(call.args[1]);
      const level = opts.get('level');
      return {
        method: 'getByRole',
        role: stringArg(call.args[0], what),
        ...optString(opts, 'name', what),
        ...optBoolean(opts, 'exact'),
        ...(level?.type === 'number' ? { level: level.value } : {}),
      };
    }
    case 'getByTestId':
    case 'getByText':
    case 'getByLabel':
    case 'getByPlaceholder':
    case 'getByAltText':
    case 'getByTitle':
      return {
        method: call.method,
        text: stringArg(call.args[0], what),
        ...optBoolean(options(call.args[1]), 'exact'),
      };
    case 'locator':
      if (call.args.length > 1) throw new Error(`${what}: options aren't supported here yet — use filter()`);
      return { method: 'locator', selector: stringArg(call.args[0], what) };
    case 'filter': {
      const opts = options(call.args[0]);
      if (opts.has('has') || opts.has('hasNot') || opts.has('visible')) {
        throw new Error(`${what}: only hasText and hasNotText are supported here yet`);
      }
      return { method: 'filter', ...optString(opts, 'hasText', what), ...optString(opts, 'hasNotText', what) };
    }
    case 'first':
    case 'last':
      return { method: call.method };
    case 'nth': {
      const index = call.args[0];
      if (index?.type !== 'number') throw new Error('nth needs an index');
      return { method: 'nth', index: index.value };
    }
    default:
      throw new Error(`unsupported method: ${call.method}()`);
  }
}

/**
 * Parse a locator expression like `getByRole('button', { name: 'Pay' }).nth(0)`
 * into a chain of calls. Throws with a human-readable message on anything
 * outside the supported subset — callers should show that message, not a
 * stack trace.
 */
export function parseLocatorExpression(expr: string): ParsedLocatorChain {
  let chain;
  try {
    chain = parseLocatorChain(expr);
  } catch (error) {
    if (error instanceof LocatorParseError && error.message.startsWith('unsupported method')) {
      throw new Error(`${error.message} — try getBy*, locator, filter, first, last, or nth`);
    }
    throw error;
  }
  const locating = chain.calls.filter((c) => LOCATING_METHODS.has(c.method));
  if (locating.length > 1) {
    throw new Error(
      `${locating[1]!.method}() can only start a chain, or follow an anchor — chained locators aren't supported here yet`,
    );
  }
  const unsupported = chain.calls.find((c) => !SUPPORTED.has(c.method));
  if (unsupported) {
    throw new Error(`unsupported method: ${unsupported.method}() — try getBy*, locator, filter, first, last, or nth`);
  }
  return { calls: chain.calls.map(toExtensionCall) };
}
