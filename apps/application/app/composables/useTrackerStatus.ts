import type { TrackerSummary } from '#shared/integrations/types';

interface TrackerStatus {
  trackers: TrackerSummary[];
}

let fetchPromise: Promise<TrackerStatus> | null = null;

/**
 * Which trackers are connected, loaded once and shared. Drives whether the
 * create-issue entry points show at all — every one hides when no tracker is
 * connected.
 */
export function useTrackerStatus() {
  const status = useState<TrackerStatus | null>('tracker-status', () => null);

  async function load() {
    if (status.value !== null) return;
    if (!fetchPromise) {
      fetchPromise = $fetch<TrackerStatus>('/api/integrations/status').catch(() => ({ trackers: [] }));
    }
    status.value = await fetchPromise;
  }

  if (import.meta.client) {
    load();
  }

  const hasTracker = computed(() => (status.value?.trackers.length ?? 0) > 0);

  return { trackerStatus: status, hasTracker };
}
