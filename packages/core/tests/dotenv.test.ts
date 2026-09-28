import { describe, expect, test } from 'vitest';
import { parseDotEnv, resolvePiwiConnection } from '../src/dotenv';

describe('parseDotEnv', () => {
  test('reads plain, quoted and exported values, and skips comments', () => {
    expect(
      parseDotEnv(
        [
          '# Piwi',
          'PIWI_DASHBOARD_URL=http://localhost:3000',
          'export PIWI_PROJECT_NAME="Acme Mugs"',
          "PIWI_API_KEY='pd_123' ",
          'PIWI_LABEL=nightly # the job',
          'not a line',
        ].join('\n'),
      ),
    ).toEqual({
      PIWI_DASHBOARD_URL: 'http://localhost:3000',
      PIWI_PROJECT_NAME: 'Acme Mugs',
      PIWI_API_KEY: 'pd_123',
      PIWI_LABEL: 'nightly',
    });
  });
});

describe('resolvePiwiConnection', () => {
  test('flags, then the environment, then .env, each key on its own', () => {
    expect(
      resolvePiwiConnection({
        flags: { project: 'web' },
        env: { PIWI_DASHBOARD_URL: 'https://piwi.example/' },
        dotEnv: { PIWI_DASHBOARD_URL: 'http://ignored', PIWI_API_KEY: 'pd_env' },
      }),
    ).toEqual({ serverUrl: 'https://piwi.example', apiKey: 'pd_env', project: 'web' });
  });

  test("the desktop app's token serves only its own URL", () => {
    const desktop = { url: 'http://127.0.0.1:3000', token: 'pd_desk' };
    expect(resolvePiwiConnection({ desktop })).toEqual({
      serverUrl: 'http://127.0.0.1:3000',
      apiKey: 'pd_desk',
      project: '',
    });
    expect(resolvePiwiConnection({ env: { PIWI_DASHBOARD_URL: 'https://other' }, desktop })!.apiKey).toBeNull();
    expect(resolvePiwiConnection({})).toBeNull();
  });
});
