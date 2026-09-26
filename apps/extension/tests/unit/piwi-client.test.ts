import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  fetchCatalog,
  fetchLocatorIndex,
  fetchProjects,
  normalizeBaseUrl,
  projectCatalogUrl,
  projectLocatorsUrl,
  testCaseUrl,
} from '../../src/shared/piwi-client';

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

describe('dashboard deep links', () => {
  test('projectLocatorsUrl prefills the locators to check, one per line', () => {
    expect(projectLocatorsUrl('https://piwi.example.com/', 3)).toBe('https://piwi.example.com/projects/3/locators');
    expect(projectLocatorsUrl('https://piwi.example.com', 3, ["getByTestId('pay')", "getByText('Pay')"])).toBe(
      `https://piwi.example.com/projects/3/locators?q=${encodeURIComponent("getByTestId('pay')\ngetByText('Pay')")}`,
    );
  });

  test('testCaseUrl points at the test case page', () => {
    expect(testCaseUrl('https://piwi.example.com/', 42)).toBe('https://piwi.example.com/test-cases/42');
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

  test('fetchLocatorIndex sends the API key and returns the index', async () => {
    const index = { projectId: 1, locators: [], tests: [], truncated: false };
    answer(index);
    expect(await fetchLocatorIndex(settings, 1)).toEqual(index);
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://piwi.example.com/api/projects/1/locator-index');
    expect((call[1] as RequestInit).headers).toEqual({ 'X-API-Key': 'pd_key' });
  });

  test('fetchLocatorIndex explains a rejected key, a missing endpoint and a malformed answer', async () => {
    answer({ message: 'nope' }, 403);
    await expect(fetchLocatorIndex(settings, 1)).rejects.toThrow('rejected the API key');
    answer({ message: 'missing' }, 404);
    await expect(fetchLocatorIndex(settings, 1)).rejects.toThrow('no locator index');
    answer({ unexpected: true });
    await expect(fetchLocatorIndex(settings, 1)).rejects.toThrow('not a locator index');
  });
});
