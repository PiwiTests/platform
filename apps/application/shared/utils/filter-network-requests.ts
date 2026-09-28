/** Resource types that convey API/document exchanges — static assets are excluded. */
export const TRACKED_RESOURCE_TYPES = ['fetch', 'xhr', 'document', 'other'] as const;

export type TrackedResourceType = (typeof TRACKED_RESOURCE_TYPES)[number];
export interface FilteredNetworkRequest {
  method: string;
  url: string;
  status: number;
  duration?: number;
  resourceType?: string;
  failure?: string;
  [key: string]: unknown;
}

/** A request answered with an error status, or one that never got a response (status 0, or a recorded failure). */
function isFailedRequest(r: FilteredNetworkRequest): boolean {
  return r.status >= 400 || r.status <= 0 || typeof r.failure === 'string';
}

/**
 * Filter raw network requests to only keep API/document types, URL-sanitised,
 * and capped to all failures + top N by duration.
 */
export function filterAndCapNetworkRequests(
  requests: FilteredNetworkRequest[],
  maxPassed = 50,
): FilteredNetworkRequest[] {
  const relevant = requests.filter(
    (r) => !r.resourceType || (TRACKED_RESOURCE_TYPES as readonly string[]).includes(r.resourceType),
  );
  if (relevant.length === 0) return [];

  const failed = relevant.filter(isFailedRequest);
  const passed = relevant.filter((r) => !isFailedRequest(r));
  passed.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return [...failed, ...passed.slice(0, maxPassed)];
}
