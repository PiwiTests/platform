/**
 * Single source of truth for the documentation site base URL and link building.
 * Lives in `shared/` so server, email, demo and app code can all reuse it.
 */
export const DOCS_BASE_URL = 'https://phenx.github.io/piwi-dashboard';

/**
 * Build an absolute docs URL from a page + optional `#anchor`.
 * @example docsUrl('flaky-tests#flaky-test-detection')
 */
export function docsUrl(pathWithAnchor: string): string {
  return `${DOCS_BASE_URL}/${pathWithAnchor.replace(/^\//, '')}`;
}
