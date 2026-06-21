import { sanitizeNetworkRequests, sanitizeUrl } from './sanitize';
import { normalizeRoute } from '../../shared/utils/route';

/**
 * Build pre-insert rows for the normalized network_requests child table.
 *
 * Takes raw network requests from a test-case payload, sanitizes them, and
 * computes normalized routes from the original (unsanitized) URLs so query
 * param keys are preserved (values redacted) for endpoint grouping.
 */
export function buildNetworkRequestItems(requests: unknown[] | null | undefined): Array<{
  method: string;
  url: string | null;
  normalizedUrl: string;
  status: number;
  duration: number | null;
  resourceType: string | null;
  serverLogs: unknown;
}> {
  const rawReqs = requests as Array<Record<string, unknown>> | null | undefined;

  const rawUrlMap = new Map<string, string>();
  if (Array.isArray(rawReqs)) {
    for (const r of rawReqs) {
      if (typeof r.url === 'string' && !rawUrlMap.has(sanitizeUrl(r.url))) {
        rawUrlMap.set(sanitizeUrl(r.url), r.url);
      }
    }
  }

  const sanitized = sanitizeNetworkRequests(rawReqs);
  if (!sanitized || sanitized.length === 0) return [];

  return sanitized.map((req) => ({
    method: req.method as string,
    url: (req.url as string) ?? null,
    normalizedUrl: normalizeRoute(rawUrlMap.get(req.url as string) ?? (req.url as string)),
    status: req.status as number,
    duration: (req.duration as number) ?? null,
    resourceType: (req.resourceType as string) ?? null,
    serverLogs: (req.serverLogs as unknown) ?? null,
  }));
}

export type NetworkRequestItem = ReturnType<typeof buildNetworkRequestItems>[number];
export type NetworkRequestBuilder = { items: NetworkRequestItem[] };

/**
 * Flatten per-case network request builders into insert-ready values by filling
 * in `testRunsCaseId` and `testRunId`.
 */
export function buildNetworkRequestInsertValues(
  networkRequestBuilders: NetworkRequestBuilder[],
  insertedCases: Array<{ id: number }>,
  testRunId: number,
): Array<NetworkRequestItem & { testRunsCaseId: number; testRunId: number }> {
  const values: ReturnType<typeof buildNetworkRequestInsertValues> = [];
  for (let i = 0; i < insertedCases.length && i < networkRequestBuilders.length; i++) {
    const caseId = insertedCases[i]!.id;
    const builder = networkRequestBuilders[i]!;
    for (const item of builder.items) {
      values.push({ testRunsCaseId: caseId, testRunId, ...item });
    }
  }
  return values;
}
