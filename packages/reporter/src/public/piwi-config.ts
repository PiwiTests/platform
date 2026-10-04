/**
 * Piwi's section of a Playwright config, declared on Playwright's `Config` so `defineConfig` checks it:
 *
 * ```ts
 * export default defineConfig({
 *   '@piwi': { codegen: { testSteps: 'page', tags: ['@recorded'] } },
 * });
 * ```
 *
 * Playwright hands the top-level keys that start with `@` to reporters as they are written; the editor service reads
 * this one to write recorded code the way the repository asks. The section is checked when it is read
 * (`codegenConfigOf` in `@piwitests/core/piwi-config`), whose option names these types must cover.
 */
import type { PIWI_CODEGEN_OPTIONS } from '@piwitests/core/piwi-config';

/** How the code a recording writes looks, for everyone working in the repository. */
export interface PiwiCodegenConfig {
  /**
   * After a step that leads to another page, wait for that page's URL and for the next step's element before going
   * on. `true` by default. A call to one of your own functions waits for its pages itself either way.
   */
  pageWaits?: boolean;
  /**
   * `literal` (default): typed values are written in the code, and only passwords are read from the environment.
   * `env`: every typed value is read from an environment variable named after its field.
   */
  values?: 'literal' | 'env';
  /**
   * What those environment variables start with: `E2E_` by default, as in `E2E_PASSWORD`. Upper-case letters, digits
   * and underscores, starting with a letter.
   */
  envPrefix?: string;
  /**
   * `page` wraps the steps of each page in `await test.step('<path>', …)`, in a test (not in a page object or a
   * helper); `none` (default) does not.
   */
  testSteps?: 'none' | 'page';
  /** Tags a new test gets, such as `@recorded`; a missing `@` is added. */
  tags?: string[];
  /** Annotations a new test gets, such as `{ type: 'piwi:owner', description: '@shop-team' }`. */
  annotations?: Array<{ type: string; description?: string }>;
}

/** Piwi's section of a Playwright config, `'@piwi'`. */
export interface PiwiConfig {
  /** How the code a recording writes looks. */
  codegen?: PiwiCodegenConfig;
}

declare module '@playwright/test' {
  interface Config<TestArgs, WorkerArgs> {
    /** Piwi's options, read from the repository by the editor extensions: how the code a recording writes looks. */
    '@piwi'?: PiwiConfig;
  }
}

/** The options `codegenConfigOf` reads and the ones declared here are the same: a compile error names the difference. */
type ReadOptions = (typeof PIWI_CODEGEN_OPTIONS)[number];
type Same<A, B> = [Exclude<A, B> | Exclude<B, A>] extends [never]
  ? true
  : { missing: Exclude<A, B>; extra: Exclude<B, A> };
const sameOptions: Same<ReadOptions, keyof PiwiCodegenConfig> = true;
void sameOptions;
