/**
 * Links into the dashboard of the connected instance. Pure: content scripts
 * build their links here, and nothing in this module reaches the network.
 */

/** The instance address as every link and request starts with it: trimmed, without a trailing slash. */
export function normalizeBaseUrl(instanceUrl: string): string {
  return instanceUrl.trim().replace(/\/+$/, '');
}

/** Deep link to a project's "Test functions" catalog page in the dashboard — used by `test-function-panel.ts`'s "Manage catalog" link. */
export function projectCatalogUrl(instanceUrl: string, projectId: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/projects/${projectId}/test-functions`;
}

/**
 * Deep link to a project's Locators page, with locators to check prefilled one
 * per line, on `branch` (null for the default branch, `*` for every branch).
 */
export function projectLocatorsUrl(
  instanceUrl: string,
  projectId: number,
  locators: string[] = [],
  branch: string | null = null,
  page: string | null = null,
): string {
  const base = `${normalizeBaseUrl(instanceUrl)}/projects/${projectId}/locators`;
  const query = [
    ...(locators.length ? [`q=${encodeURIComponent(locators.join('\n'))}`] : []),
    ...(branch ? [`branch=${encodeURIComponent(branch)}`] : []),
    ...(page ? [`page=${encodeURIComponent(page)}`] : []),
  ];
  return query.length ? `${base}?${query.join('&')}` : base;
}

/** Deep link to a test case's page in the dashboard. */
export function testCaseUrl(instanceUrl: string, testCaseId: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/test-cases/${testCaseId}`;
}

/** Deep link to a bug report's page in the dashboard. */
export function bugReportUrl(instanceUrl: string, id: number): string {
  return `${normalizeBaseUrl(instanceUrl)}/bug-reports/${id}`;
}
