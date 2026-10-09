import type { TrackerSummary } from '#shared/integrations/types';

interface TrackerStatus {
  trackers: TrackerSummary[];
}

/**
 * Which trackers are connected. Drives whether the create-issue entry points
 * show at all — every one hides when no tracker is connected.
 *
 * Backed by `useAsyncData` keyed `tracker-status`, so the status is read during
 * the server render and the entry points are in the first paint rather than
 * appearing after hydration; every caller shares the one answer. `refresh()`
 * reads it again, after a connection is added or removed. A read failure
 * resolves to no tracker.
 */
export function useTrackerStatus() {
  const requestFetch = useRequestFetch();
  const { data: status, refresh } = useAsyncData<TrackerStatus>(
    'tracker-status',
    () => requestFetch<TrackerStatus>('/api/integrations/status').catch(() => ({ trackers: [] })),
    { default: () => ({ trackers: [] }), dedupe: 'defer', getCachedData: reuseWithinRender },
  );

  const hasTracker = computed(() => (status.value?.trackers.length ?? 0) > 0);

  return { trackerStatus: status, hasTracker, refresh };
}
