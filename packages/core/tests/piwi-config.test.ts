import { describe, test, expect } from 'vitest';
import { codegenConfigOf } from '../src/piwi-config';

describe('codegenConfigOf', () => {
  test('turns each option into the code generation option it sets', () => {
    expect(
      codegenConfigOf({
        codegen: {
          pageWaits: false,
          values: 'env',
          envPrefix: 'SHOP_',
          testSteps: 'page',
          tags: ['@recorded', 'smoke'],
          annotations: [{ type: 'piwi:owner', description: '@shop-team' }, { type: 'piwi:recorded' }],
        },
      }),
    ).toEqual({
      options: {
        urlChecks: false,
        values: 'env',
        envPrefix: 'SHOP_',
        testSteps: 'page',
        tags: ['@recorded', 'smoke'],
        annotations: [{ type: 'piwi:owner', description: '@shop-team' }, { type: 'piwi:recorded' }],
      },
      problems: [],
    });
  });

  test('no section, or a section without codegen, sets nothing', () => {
    expect(codegenConfigOf(undefined)).toEqual({ options: {}, problems: [] });
    expect(codegenConfigOf({})).toEqual({ options: {}, problems: [] });
  });

  test('a value of the wrong kind or an unknown option is left out, and the others still apply', () => {
    const { options, problems } = codegenConfigOf({
      codegen: {
        pageWaits: 'no',
        values: 'secret',
        envPrefix: 'e2e_',
        testSteps: 'call',
        tags: ['@ok', ''],
        annotations: [{ description: 'no type' }],
        steps: 'page',
        testSteps2: true,
      },
    });
    expect(options).toEqual({});
    expect(problems).toEqual([
      '@piwi.codegen.steps is not a Piwi option; it is ignored.',
      '@piwi.codegen.testSteps2 is not a Piwi option; it is ignored.',
      '@piwi.codegen.pageWaits must be true or false; it is ignored.',
      "@piwi.codegen.values must be 'literal' or 'env'; it is ignored.",
      '@piwi.codegen.envPrefix must be upper-case letters, digits and underscores, starting with a letter; it is ignored.',
      "@piwi.codegen.testSteps must be 'none' or 'page'; it is ignored.",
      '@piwi.codegen.tags must be a list of tags; it is ignored.',
      '@piwi.codegen.annotations must be a list of { type, description? }; it is ignored.',
    ]);
    expect(codegenConfigOf({ codegen: { values: 'env', testSteps: 'nope' } }).options).toEqual({ values: 'env' });
  });

  test('a section or a codegen that is not an object is ignored', () => {
    expect(codegenConfigOf('x').problems).toEqual(['@piwi is not an object; it is ignored.']);
    expect(codegenConfigOf({ codegen: [] }).problems).toEqual(['@piwi.codegen is not an object; it is ignored.']);
  });
});
