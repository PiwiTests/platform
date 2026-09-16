import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  decideAddReporter,
  playwrightSupportsAddReporter,
  configHasPiwiReporter,
  computeAddReporterArgs,
  ADD_REPORTER_FLAG,
  REPORTER_PACKAGE,
} from '../src/cli/add-reporter.js';

const PLAIN_CONFIG = `import { defineConfig } from '@playwright/test'\nexport default defineConfig({ testDir: './tests' })\n`;
const WRAPPED_CONFIG = `import { wrapConfig } from '@piwitests/reporter'\nexport default wrapConfig(defineConfig({}), { projectName: 'x' })\n`;

describe('playwrightSupportsAddReporter', () => {
  it('accepts 1.63 and later', () => {
    expect(playwrightSupportsAddReporter('1.63.0')).toBe(true);
    expect(playwrightSupportsAddReporter('1.64.2')).toBe(true);
    expect(playwrightSupportsAddReporter('2.0.0')).toBe(true);
  });

  it('rejects earlier versions and unknown input', () => {
    expect(playwrightSupportsAddReporter('1.61.1')).toBe(false);
    expect(playwrightSupportsAddReporter('1.62.0')).toBe(false);
    expect(playwrightSupportsAddReporter(null)).toBe(false);
    expect(playwrightSupportsAddReporter(undefined)).toBe(false);
    expect(playwrightSupportsAddReporter('not-a-version')).toBe(false);
  });
});

describe('configHasPiwiReporter', () => {
  it('detects the reporter package in a config', () => {
    expect(configHasPiwiReporter(WRAPPED_CONFIG)).toBe(true);
    expect(configHasPiwiReporter(`reporter: [['@piwitests/reporter']]`)).toBe(true);
  });

  it('is false for a config without it', () => {
    expect(configHasPiwiReporter(PLAIN_CONFIG)).toBe(false);
  });
});

describe('decideAddReporter', () => {
  it('appends the reporter when the config lacks it and Playwright is 1.63+', () => {
    const decision = decideAddReporter(PLAIN_CONFIG, '1.63.0');
    expect(decision.args).toEqual([ADD_REPORTER_FLAG, REPORTER_PACKAGE]);
    expect(decision.log).toContain(ADD_REPORTER_FLAG);
  });

  it('adds nothing but logs on an older Playwright', () => {
    const decision = decideAddReporter(PLAIN_CONFIG, '1.61.1');
    expect(decision.args).toEqual([]);
    expect(decision.log).toContain('1.63');
    expect(decision.log).toContain('will not reach the dashboard');
  });

  it('does nothing when the config already wires in the reporter', () => {
    expect(decideAddReporter(WRAPPED_CONFIG, '1.63.0')).toEqual({ args: [], log: null });
  });

  it('does nothing when no config was found', () => {
    expect(decideAddReporter(null, '1.63.0')).toEqual({ args: [], log: null });
  });
});

describe('computeAddReporterArgs', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-addrep-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('adds nothing when the config already has the reporter', () => {
    fs.writeFileSync(path.join(root, 'playwright.config.ts'), WRAPPED_CONFIG);
    expect(computeAddReporterArgs(root, []).args).toEqual([]);
  });

  it('adds nothing when there is no config at all', () => {
    expect(computeAddReporterArgs(root, [])).toEqual({ args: [], log: null });
  });

  it('honors an explicit --config path when locating the config', () => {
    fs.writeFileSync(path.join(root, 'custom.config.ts'), WRAPPED_CONFIG);
    // The default-named config is absent; only the explicit one wires in the reporter.
    expect(computeAddReporterArgs(root, ['--config', 'custom.config.ts']).args).toEqual([]);
  });
});
