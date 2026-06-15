import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { wrapConfig } from '../src/config-wrapper.js';

describe('wrapConfig', () => {
  it('preserves other config properties', () => {
    const config = wrapConfig({
      testDir: './tests',
      timeout: 30_000,
      retries: 2,
      fullyParallel: true,
    });
    assert.equal(config.testDir, './tests');
    assert.equal(config.timeout, 30_000);
    assert.equal(config.retries, 2);
    assert.equal(config.fullyParallel, true);
  });

  it('adds piwi global-setup-module when no original globalSetup exists', () => {
    const config = wrapConfig({ testDir: './tests' });
    assert.equal(typeof config.globalSetup, 'string');
    assert.ok((config.globalSetup as string).includes('global-setup-module'));
  });

  it('keeps original globalSetup string and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: './tests/globalSetup' });
    assert.ok(Array.isArray(config.globalSetup));
    assert.equal((config.globalSetup as string[]).length, 2);
    assert.equal((config.globalSetup as string[])[0], './tests/globalSetup');
    assert.ok((config.globalSetup as string[])[1].includes('global-setup-module'));
  });

  it('keeps original globalSetup array and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: ['./tests/cleanup', './tests/bootstrap'] });
    assert.ok(Array.isArray(config.globalSetup));
    assert.equal((config.globalSetup as string[]).length, 3);
    assert.equal((config.globalSetup as string[])[0], './tests/cleanup');
    assert.equal((config.globalSetup as string[])[1], './tests/bootstrap');
    assert.ok((config.globalSetup as string[])[2].includes('global-setup-module'));
  });

  it('injects piwi reporter when no reporter is set', () => {
    const config = wrapConfig({ testDir: './tests' });
    assert.ok(Array.isArray(config.reporter));
    assert.equal((config.reporter as any[]).length, 1);
    assert.equal((config.reporter as any[])[0][0], '@phenx/piwi-dashboard-reporter');
  });

  it('injects piwi reporter alongside an existing string reporter', () => {
    const config = wrapConfig({ reporter: 'list' });
    assert.ok(Array.isArray(config.reporter));
    assert.equal((config.reporter as any[]).length, 2);
    assert.equal((config.reporter as any[])[1][0], '@phenx/piwi-dashboard-reporter');
  });

  it('injects piwi reporter alongside an existing array reporter', () => {
    const config = wrapConfig({ reporter: [['json', { outputFile: 'report.json' }]] });
    assert.ok(Array.isArray(config.reporter));
    assert.equal((config.reporter as any[]).length, 2);
    assert.equal((config.reporter as any[])[1][0], '@phenx/piwi-dashboard-reporter');
  });

  it('does not duplicate piwi reporter if already present', () => {
    const config = wrapConfig({
      reporter: [['@phenx/piwi-dashboard-reporter', { projectName: 'test' }]],
    });
    assert.ok(Array.isArray(config.reporter));
    assert.equal((config.reporter as any[]).length, 1);
  });

  it('passes piwiOptions to the injected reporter entry', () => {
    const config = wrapConfig(
      { testDir: './tests' },
      { projectName: 'my-project', serverUrl: 'http://localhost:3000' },
    );
    const entry = (config.reporter as any[]).find((r: any) => r[0] === '@phenx/piwi-dashboard-reporter');
    assert.ok(entry);
    assert.equal(entry[1]?.projectName, 'my-project');
    assert.equal(entry[1]?.serverUrl, 'http://localhost:3000');
  });
});
