import { describe, test, expect } from 'vitest';
import { rebaseTestImport } from '#shared/handlers/bug-reports';

describe('rebaseTestImport', () => {
  test('points a relative import, written for the bugs folder, at the same module from another folder', () => {
    expect(rebaseTestImport('../fixtures', 'e2e/regressions/bugs', 'e2e/piwi-repro')).toBe('../regressions/fixtures');
    expect(rebaseTestImport('./fixtures', 'tests/bugs', 'tests/piwi-repro')).toBe('../bugs/fixtures');
    expect(rebaseTestImport('../../support/test', 'e2e/bugs', 'e2e/piwi-repro')).toBe('../../support/test');
  });

  test('keeps the import as written for a spec in the bugs folder itself', () => {
    expect(rebaseTestImport('../fixtures', 'tests/bugs', 'tests/bugs')).toBe('../fixtures');
    expect(rebaseTestImport('./fixtures', 'tests/bugs', 'tests/bugs')).toBe('./fixtures');
  });

  test('leaves a package name alone', () => {
    expect(rebaseTestImport('@acme/test-kit', 'tests/bugs', 'e2e/piwi-repro')).toBe('@acme/test-kit');
    expect(rebaseTestImport('@playwright/test', 'tests/bugs', 'e2e/piwi-repro')).toBe('@playwright/test');
  });
});
