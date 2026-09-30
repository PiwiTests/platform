import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { linkedDesktopProject, readDesktopDiscovery, resolveContextConnection } from '../src/context';

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
      source: 'editor',
    });
  });

  test('names where the server came from', () => {
    const root = workspace('PIWI_DASHBOARD_URL=https://piwi.corp\n');
    expect(resolveContextConnection(root, root, env, saved)?.source).toBe('dotenv');
    expect(
      resolveContextConnection(root, root, { ...env, PIWI_DASHBOARD_URL: 'https://ci.piwi.corp' }, saved)?.source,
    ).toBe('environment');
  });
});

describe('the desktop app', () => {
  function desktopApp(projects: unknown[]): Record<string, string> {
    const dir = workspace();
    const file = path.join(dir, 'desktop.json');
    writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:3000/', token: 'pd_desktop', projects }));
    return { PIWI_DESKTOP_CONFIG: file };
  }

  test('connects with its token, to the project linked to this folder', () => {
    const root = workspace();
    const env = desktopApp([
      { id: 4, path: path.dirname(root) },
      { id: 7, path: root },
      { id: 9, path: '/elsewhere' },
    ]);
    expect(resolveContextConnection(path.join(root, 'e2e'), root, env, {})).toEqual({
      serverUrl: 'http://127.0.0.1:3000',
      apiKey: 'pd_desktop',
      project: '7',
      source: 'desktop',
    });
  });

  test('comes after the instance saved in the editor', () => {
    const root = workspace();
    const env = desktopApp([{ id: 7, path: root }]);
    expect(resolveContextConnection(root, root, env, saved)).toMatchObject({
      serverUrl: 'https://piwi.corp',
      apiKey: 'pk_saved',
      source: 'editor',
    });
  });

  test('takes the project PIWI_PROJECT_NAME or the editor names before the linked one', () => {
    const root = workspace('PIWI_PROJECT_NAME=Shop\n');
    const env = desktopApp([{ id: 7, path: root }]);
    expect(resolveContextConnection(root, root, env, {})?.project).toBe('Shop');
    const plain = workspace();
    expect(
      resolveContextConnection(plain, plain, desktopApp([{ id: 7, path: plain }]), { project: 'Mugs' })?.project,
    ).toBe('Mugs');
  });

  test('without a link, connects with no project', () => {
    const root = workspace();
    expect(resolveContextConnection(root, root, desktopApp([]), {})).toMatchObject({ project: '', source: 'desktop' });
  });

  test('a workspace .env naming the desktop app gets its token and its link', () => {
    const root = workspace('PIWI_DASHBOARD_URL=http://127.0.0.1:3000\n');
    const env = desktopApp([{ id: 7, path: root }]);
    expect(resolveContextConnection(root, root, env, {})).toEqual({
      serverUrl: 'http://127.0.0.1:3000',
      apiKey: 'pd_desktop',
      project: '7',
      source: 'dotenv',
    });
  });

  test('reads only well-formed links, and the deepest link wins', () => {
    const env = desktopApp([{ id: '3', path: '/a' }, { id: 5 }, { id: 6, path: '/w' }, { id: 8, path: '/w/app' }]);
    const desktop = readDesktopDiscovery(env);
    expect(desktop?.projects).toEqual([
      { id: 6, path: '/w' },
      { id: 8, path: '/w/app' },
    ]);
    expect(linkedDesktopProject(desktop, '/w/app/tests')).toBe(8);
    expect(linkedDesktopProject(desktop, '/w/other')).toBe(6);
    expect(linkedDesktopProject(desktop, '/elsewhere')).toBeNull();
  });
});
