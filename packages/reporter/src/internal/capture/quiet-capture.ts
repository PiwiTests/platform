import { createRequire } from 'node:module';
import * as path from 'node:path';
import { findOwnPackageJson } from '../support/reporter-version.js';

/**
 * Keeps the capture fixtures out of the test's own record. The fixtures wrap
 * locators and read the page; Playwright attributes an API call to the first
 * stack frame outside its own packages and reports every call as a step, so
 * without these hooks a wrapped action points at the wrapper and every probe
 * is listed among the test's steps. Both hooks are Playwright internals,
 * feature-detected: on a Playwright without them the fixtures still capture,
 * and their calls show as ordinary steps.
 */

type SetBoxedStackPrefixes = (prefixes: string[]) => void;

/** Where each Playwright layout exports `setBoxedStackPrefixes`, newest first. */
const BOXED_PREFIX_EXPORTS: Array<[moduleId: string, pick: (mod: unknown) => unknown]> = [
  [
    'playwright-core/lib/coreBundle',
    (mod) => (mod as { utils?: Record<string, unknown> } | null)?.utils?.setBoxedStackPrefixes,
  ],
  ['playwright-core/lib/utils', (mod) => (mod as Record<string, unknown> | null)?.setBoxedStackPrefixes],
];

let framesBoxed = false;

/**
 * Register this package's `dist/` directory as a boxed stack prefix — the list
 * Playwright filters its own frames with — so a wrapped action's step location
 * and error stack name the test's line instead of the wrapper. Playwright's own
 * package stays in the list. Runs once per worker; a missing hook or an
 * unexpected layout leaves Playwright's defaults untouched.
 */
export function boxCaptureFrames(): void {
  if (framesBoxed) return;
  framesBoxed = true;
  try {
    const root = findOwnPackageJson(__dirname)?.root;
    if (!root) return;
    // Resolve through @playwright/test → playwright, the same path Playwright's
    // own `require('playwright-core/…')` takes, so the module (and its prefix
    // list) is the instance the test runner uses.
    const testPackageJson = createRequire(__filename).resolve('@playwright/test/package.json');
    const playwrightPackageJson = createRequire(testPackageJson).resolve('playwright/package.json');
    const requireFromPlaywright = createRequire(playwrightPackageJson);
    for (const [moduleId, pick] of BOXED_PREFIX_EXPORTS) {
      let setPrefixes: unknown;
      try {
        setPrefixes = pick(requireFromPlaywright(moduleId));
      } catch {
        continue;
      }
      if (typeof setPrefixes !== 'function') continue;
      (setPrefixes as SetBoxedStackPrefixes)([path.dirname(playwrightPackageJson), path.join(root, 'dist') + path.sep]);
      return;
    }
  } catch {
    // An install layout the lookup does not know: keep Playwright's defaults.
  }
}

type ApiCallOwner = {
  _wrapApiCall?: (run: () => Promise<unknown>, options: { internal: boolean; title?: string }) => Promise<unknown>;
};

/**
 * Run a page read as an internal Playwright call: every API call made inside
 * `run` is kept out of the test's steps and the trace. `owner` is the page (or
 * any Playwright channel object) the reads go through; without the hook the
 * read simply runs.
 */
export function internalCall<T>(owner: unknown, run: () => Promise<T>): Promise<T> {
  const wrap = (owner as ApiCallOwner | null | undefined)?._wrapApiCall;
  if (typeof wrap !== 'function') return run();
  return wrap.call(owner, run, { internal: true, title: 'Piwi capture' }) as Promise<T>;
}
