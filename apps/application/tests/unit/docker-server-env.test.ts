import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The shim is preloaded ahead of the bundled server in the Docker image, so it
// is exercised the same way here: a child Node process imports it and prints
// the environment it leaves behind.
const SHIM = fileURLToPath(new URL('../../../../docker-server-env.mjs', import.meta.url));

function envAfterShim(env: Record<string, string>): Record<string, string | undefined> {
  const output = execFileSync(
    process.execPath,
    ['--import', SHIM, '-e', 'process.stdout.write(JSON.stringify(process.env))'],
    { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' },
  );
  return JSON.parse(output) as Record<string, string | undefined>;
}

describe('docker-server-env', () => {
  test('maps PIWI_AUTH_* onto the NUXT_* overrides', () => {
    const env = envAfterShim({ PIWI_AUTH_ENABLED: 'true', PIWI_AUTH_SECRET: 's3cret' });

    expect(env.NUXT_AUTH_ENABLED).toBe('true');
    expect(env.NUXT_PUBLIC_AUTH_ENABLED).toBe('true');
    expect(env.NUXT_AUTH_SECRET).toBe('s3cret');
  });

  test('maps every PIWI_OAUTH_* variable and lists the configured providers', () => {
    const env = envAfterShim({
      PIWI_OAUTH_GOOGLE_CLIENT_ID: 'g-id',
      PIWI_OAUTH_GOOGLE_CLIENT_SECRET: 'g-secret',
      PIWI_OAUTH_GITHUB_CLIENT_ID: 'gh-id',
      PIWI_OAUTH_GITHUB_CLIENT_SECRET: 'gh-secret',
      PIWI_OAUTH_ALLOWED_DOMAINS: 'example.com',
      PIWI_OAUTH_GITHUB_ALLOWED_ORGS: 'acme',
    });

    expect(env.NUXT_OAUTH_GOOGLE_CLIENT_ID).toBe('g-id');
    expect(env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET).toBe('g-secret');
    expect(env.NUXT_OAUTH_GITHUB_CLIENT_ID).toBe('gh-id');
    expect(env.NUXT_OAUTH_GITHUB_CLIENT_SECRET).toBe('gh-secret');
    expect(env.NUXT_OAUTH_ALLOWED_DOMAINS).toBe('example.com');
    expect(env.NUXT_OAUTH_GITHUB_ALLOWED_ORGS).toBe('acme');
    expect(JSON.parse(env.NUXT_PUBLIC_OAUTH_PROVIDERS ?? '[]')).toEqual(['google', 'github']);
  });

  test('a provider missing its secret is not listed', () => {
    const env = envAfterShim({
      PIWI_OAUTH_GOOGLE_CLIENT_ID: 'g-id',
      PIWI_OAUTH_GOOGLE_CLIENT_SECRET: 'g-secret',
      PIWI_OAUTH_GITHUB_CLIENT_ID: 'gh-id',
    });

    expect(JSON.parse(env.NUXT_PUBLIC_OAUTH_PROVIDERS ?? '[]')).toEqual(['google']);
  });

  test('a NUXT_* value set by the operator wins over the PIWI_* one', () => {
    const env = envAfterShim({
      PIWI_OAUTH_GOOGLE_CLIENT_ID: 'from-piwi',
      PIWI_OAUTH_GOOGLE_CLIENT_SECRET: 'g-secret',
      NUXT_OAUTH_GOOGLE_CLIENT_ID: 'from-nuxt',
      NUXT_PUBLIC_OAUTH_PROVIDERS: '["github"]',
    });

    expect(env.NUXT_OAUTH_GOOGLE_CLIENT_ID).toBe('from-nuxt');
    expect(env.NUXT_PUBLIC_OAUTH_PROVIDERS).toBe('["github"]');
  });

  test('leaves the environment alone when nothing is configured', () => {
    const env = envAfterShim({});

    const touched = Object.keys(env).filter((key) => key.startsWith('NUXT_'));
    expect(touched).toEqual([]);
  });
});
