import { describe, it, expect } from 'vitest';
import { wrapConfig } from '../src/config-wrapper.js';

describe('wrapConfig', () => {
  it('preserves other config properties', () => {
    const config = wrapConfig({
      testDir: './tests',
      timeout: 30_000,
      retries: 2,
      fullyParallel: true,
    });
    expect(config.testDir).toBe('./tests');
    expect(config.timeout).toBe(30_000);
    expect(config.retries).toBe(2);
    expect(config.fullyParallel).toBe(true);
  });

  it('adds piwi global-setup-module when no original globalSetup exists', () => {
    const config = wrapConfig({ testDir: './tests' });
    expect(typeof config.globalSetup).toBe('string');
    expect((config.globalSetup as string).includes('global-setup-module')).toBeTruthy();
  });

  it('keeps original globalSetup string and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: './tests/globalSetup' });
    expect(Array.isArray(config.globalSetup)).toBeTruthy();
    expect((config.globalSetup as string[]).length).toBe(2);
    expect((config.globalSetup as string[])[0]).toBe('./tests/globalSetup');
    expect((config.globalSetup as string[])[1].includes('global-setup-module')).toBeTruthy();
  });

  it('keeps original globalSetup array and appends piwi module', () => {
    const config = wrapConfig({ globalSetup: ['./tests/cleanup', './tests/bootstrap'] });
    expect(Array.isArray(config.globalSetup)).toBeTruthy();
    expect((config.globalSetup as string[]).length).toBe(3);
    expect((config.globalSetup as string[])[0]).toBe('./tests/cleanup');
    expect((config.globalSetup as string[])[1]).toBe('./tests/bootstrap');
    expect((config.globalSetup as string[])[2].includes('global-setup-module')).toBeTruthy();
  });

  it('injects piwi reporter when no reporter is set', () => {
    const config = wrapConfig({ testDir: './tests' });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(1);
    expect((config.reporter as any[])[0][0]).toBe('@piwitests/reporter');
  });

  it('injects piwi reporter alongside an existing string reporter', () => {
    const config = wrapConfig({ reporter: 'list' });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(2);
    expect((config.reporter as any[])[1][0]).toBe('@piwitests/reporter');
  });

  it('injects piwi reporter alongside an existing array reporter', () => {
    const config = wrapConfig({ reporter: [['json', { outputFile: 'report.json' }]] });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(2);
    expect((config.reporter as any[])[1][0]).toBe('@piwitests/reporter');
  });

  it('does not duplicate piwi reporter if already present', () => {
    const config = wrapConfig({
      reporter: [['@piwitests/reporter', { projectName: 'test' }]],
    });
    expect(Array.isArray(config.reporter)).toBeTruthy();
    expect((config.reporter as any[]).length).toBe(1);
  });

  it('passes piwiOptions to the injected reporter entry', () => {
    const config = wrapConfig(
      { testDir: './tests' },
      { projectName: 'my-project', serverUrl: 'http://localhost:3000' },
    );
    const entry = (config.reporter as any[]).find((r: any) => r[0] === '@piwitests/reporter');
    expect(entry).toBeTruthy();
    expect(entry[1]?.projectName).toBe('my-project');
    expect(entry[1]?.serverUrl).toBe('http://localhost:3000');
  });
});
