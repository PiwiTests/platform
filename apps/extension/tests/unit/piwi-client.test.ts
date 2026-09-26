import { describe, test, expect, vi, afterEach } from 'vitest';
import { fetchCatalog, fetchProjects, normalizeBaseUrl, projectCatalogUrl } from '../../src/shared/piwi-client';

describe('normalizeBaseUrl', () => {
  test('trims whitespace and a trailing slash', () => {
    expect(normalizeBaseUrl('  https://piwi.example.com/  ')).toBe('https://piwi.example.com');
  });

  test('strips multiple trailing slashes', () => {
    expect(normalizeBaseUrl('https://piwi.example.com///')).toBe('https://piwi.example.com');
  });

  test('leaves an already-clean URL untouched', () => {
    expect(normalizeBaseUrl('https://piwi.example.com')).toBe('https://piwi.example.com');
  });
});

describe('projectCatalogUrl', () => {
  test('builds the dashboard test-functions page URL for a project', () => {
    expect(projectCatalogUrl('https://piwi.example.com', 7)).toBe('https://piwi.example.com/projects/7/test-functions');
  });

  test('normalizes a trailing slash on the instance URL first', () => {
    expect(projectCatalogUrl('https://piwi.example.com/', 7)).toBe(
      'https://piwi.example.com/projects/7/test-functions',
    );
  });
});

describe('responses as the dashboard sends them', () => {
  const settings = { instanceUrl: 'https://piwi.example.com', apiKey: 'pd_key', projectMappings: [] };
  const answer = (body: unknown, status = 200) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      ),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetchProjects reads the { items } list the menu endpoint returns', async () => {
    answer({ items: [{ id: 1, name: 'shop', label: null }] });
    expect(await fetchProjects(settings)).toEqual([{ id: 1, name: 'shop', label: null }]);
    answer([{ id: 2, name: 'api', label: 'API' }]);
    expect(await fetchProjects(settings)).toEqual([{ id: 2, name: 'api', label: 'API' }]);
  });

  test('fetchCatalog reads the entries out of { items }', async () => {
    const entry = { id: 5, name: 'login', kind: 'helper' };
    answer({ items: [{ id: 5, name: 'login', entry }] });
    expect(await fetchCatalog(settings, 1)).toEqual([entry]);
    answer({ testFunctions: [{ entry }] });
    expect(await fetchCatalog(settings, 1)).toEqual([entry]);
  });
});
