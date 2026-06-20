/** Resource types that convey API/document exchanges — static assets are excluded. */
export const TRACKED_RESOURCE_TYPES = ['fetch', 'xhr', 'document', 'other'] as const;

export type TrackedResourceType = (typeof TRACKED_RESOURCE_TYPES)[number];
export interface FilteredNetworkRequest {
  method: string;
  url: string;
  status: number;
  duration?: number;
  resourceType?: string;
  [key: string]: unknown;
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

  const failed = relevant.filter((r) => r.status >= 400);
  const passed = relevant.filter((r) => r.status < 400);
  passed.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return [...failed, ...passed.slice(0, maxPassed)];
}
