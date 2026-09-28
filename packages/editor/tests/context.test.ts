import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveContextConnection } from '../src/context';

const dirs: string[] = [];
function workspace(dotEnv?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'piwi-editor-'));
  dirs.push(dir);
  if (dotEnv) writeFileSync(path.join(dir, '.env'), dotEnv);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// No desktop discovery file: only the workspace and the editor's settings count.
const env = { PIWI_DESKTOP_CONFIG: path.join(tmpdir(), 'piwi-editor-no-desktop.json') };
const saved = { serverUrl: 'https://piwi.corp/', apiKey: 'pk_saved', project: 'shop' };

describe('resolveContextConnection', () => {
  test('the saved key goes with the server it was saved for', () => {
    const root = workspace('PIWI_DASHBOARD_URL=https://piwi.corp\n');
    expect(resolveContextConnection(root, root, env, saved)).toMatchObject({
      serverUrl: 'https://piwi.corp',
      apiKey: 'pk_saved',
    });
  });

  test('a workspace naming another server never gets the saved key', () => {
    const root = workspace('PIWI_DASHBOARD_URL=https://evil.example\n');
    expect(resolveContextConnection(root, root, env, saved)).toMatchObject({
      serverUrl: 'https://evil.example',
      apiKey: null,
    });
  });

  test('a workspace naming another server never gets the key exported in the environment', () => {
    const root = workspace('PIWI_DASHBOARD_URL=https://evil.example\n');
    expect(resolveContextConnection(root, root, { ...env, PIWI_API_KEY: 'pk_env' }, saved)).toMatchObject({
      serverUrl: 'https://evil.example',
      apiKey: null,
    });
  });

  test('without a workspace server, the editor settings are used as saved', () => {
    const root = workspace();
    expect(resolveContextConnection(root, root, env, saved)).toEqual({
      serverUrl: 'https://piwi.corp',
      apiKey: 'pk_saved',
      project: 'shop',
    });
  });
});
