/**
 * Piwi's section of a Playwright config: `'@piwi': { codegen: { … } }` at the top level of `defineConfig`.
 * Playwright hands the top-level keys that start with `@` to reporters as they are written, which is how the editor
 * service reads this one. `codegenConfigOf` checks what it holds and turns it into code generation options; the
 * section's types, for the people writing it, are `@piwitests/reporter`'s `PiwiConfig`.
 */
import type { CodegenOptions } from './codegen';

/** The key of Piwi's section in a Playwright config. */
export const PIWI_CONFIG_KEY = '@piwi';

/**
 * The options of `'@piwi'.codegen`. `@piwitests/reporter` declares their types on Playwright's `Config`
 * (`PiwiCodegenConfig`), and checks it names these.
 */
export const PIWI_CODEGEN_OPTIONS = ['pageWaits', 'values', 'envPrefix', 'testSteps', 'tags', 'annotations'] as const;

/** The code generation options a Piwi section sets. */
export type CodegenConfigOptions = Pick<
  CodegenOptions,
  'urlChecks' | 'values' | 'envPrefix' | 'testSteps' | 'tags' | 'annotations'
>;

export interface CodegenConfig {
  options: CodegenConfigOptions;
  /** What the section holds that is not used, one sentence each. */
  problems: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KNOWN: ReadonlySet<string> = new Set(PIWI_CODEGEN_OPTIONS);

/**
 * The code generation options in a Piwi section (the value of `'@piwi'`), and what it holds that is not used: an
 * unknown option, or a value of the wrong kind, is left out, and the others still apply.
 */
export function codegenConfigOf(section: unknown): CodegenConfig {
  const options: CodegenConfigOptions = {};
  const problems: string[] = [];
  if (section == null) return { options, problems };
  if (!isRecord(section)) return { options, problems: [`${PIWI_CONFIG_KEY} is not an object; it is ignored.`] };
  const codegen = section.codegen;
  if (codegen == null) return { options, problems };
  const at = (key: string) => `${PIWI_CONFIG_KEY}.codegen.${key}`;
  if (!isRecord(codegen)) return { options, problems: [`${PIWI_CONFIG_KEY}.codegen is not an object; it is ignored.`] };

  for (const key of Object.keys(codegen)) {
    if (!KNOWN.has(key)) problems.push(`${at(key)} is not a Piwi option; it is ignored.`);
  }
  const { pageWaits, values, envPrefix, testSteps, tags, annotations } = codegen;
  if (pageWaits !== undefined) {
    if (typeof pageWaits === 'boolean') options.urlChecks = pageWaits;
    else problems.push(`${at('pageWaits')} must be true or false; it is ignored.`);
  }
  if (values !== undefined) {
    if (values === 'literal' || values === 'env') options.values = values;
    else problems.push(`${at('values')} must be 'literal' or 'env'; it is ignored.`);
  }
  if (envPrefix !== undefined) {
    if (typeof envPrefix === 'string' && /^[A-Z][A-Z0-9_]*$/.test(envPrefix)) options.envPrefix = envPrefix;
    else
      problems.push(
        `${at('envPrefix')} must be upper-case letters, digits and underscores, starting with a letter; it is ignored.`,
      );
  }
  if (testSteps !== undefined) {
    if (testSteps === 'none' || testSteps === 'page') options.testSteps = testSteps;
    else problems.push(`${at('testSteps')} must be 'none' or 'page'; it is ignored.`);
  }
  if (tags !== undefined) {
    if (Array.isArray(tags) && tags.every((t) => typeof t === 'string' && t.trim() !== ''))
      options.tags = tags as string[];
    else problems.push(`${at('tags')} must be a list of tags; it is ignored.`);
  }
  if (annotations !== undefined) {
    const valid =
      Array.isArray(annotations) &&
      annotations.every(
        (a) =>
          isRecord(a) &&
          typeof a.type === 'string' &&
          a.type.trim() !== '' &&
          (a.description === undefined || typeof a.description === 'string'),
      );
    if (valid)
      options.annotations = (annotations as Array<{ type: string; description?: string }>).map((a) =>
        a.description === undefined ? { type: a.type } : { type: a.type, description: a.description },
      );
    else problems.push(`${at('annotations')} must be a list of { type, description? }; it is ignored.`);
  }
  return { options, problems };
}
