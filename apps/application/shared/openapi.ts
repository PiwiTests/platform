/**
 * Turn an OpenAPI document into a declared-surface {@link AppManifest}: one route
 * per path × method, carrying the documented response status codes. Pure and
 * dependency-free so the demo and the unit tests run it directly; the server util
 * fetches the document and hands the parsed JSON here.
 */

import type { AppManifest, ManifestRoute } from '#shared/types';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

/** Response keys are status codes or ranges (`2XX`) or `default`; keep the numeric ones. */
function documentedCodes(responses: unknown): number[] {
  if (!responses || typeof responses !== 'object') return [];
  const out = new Set<number>();
  for (const key of Object.keys(responses as Record<string, unknown>)) {
    const code = Number.parseInt(key, 10);
    if (Number.isInteger(code) && code >= 100 && code <= 599) out.add(code);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Parse an OpenAPI 3.x document into a manifest. Malformed input yields an empty
 * manifest rather than throwing — a broken spec must never break ingest.
 */
export function parseOpenApiSpec(spec: unknown): AppManifest {
  const routes: ManifestRoute[] = [];
  const paths = (spec as { paths?: unknown } | null)?.paths;
  if (!paths || typeof paths !== 'object') return { routes: [] };
  for (const [pattern, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const responses = (operation as { responses?: unknown } | null)?.responses;
      routes.push({ method: method.toUpperCase(), pattern, responses: documentedCodes(responses) });
    }
  }
  return { routes };
}
