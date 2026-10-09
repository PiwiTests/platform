import type { FailureTimeline } from '#shared/failure-timeline';

/**
 * The failure timeline of one execution (`/api/test-run-cases/:id/timeline`),
 * under one key per execution for every card of its evidence that reads it:
 * the Timeline tab draws it, the Network tab colors each request against its
 * usual duration. Only a failed execution has one, so `load` says whether this
 * reader needs it now; a reader that needs it fetches it unless another already
 * has, and none clears it, so a tab switch reuses what the evidence card holds.
 * The cluster page swaps the execution in place: the new one is fetched afresh.
 */
export function useExecutionTimeline(id: MaybeRefOrGetter<number>, load: MaybeRefOrGetter<boolean>) {
  const timeline = useFetch<FailureTimeline>(() => `/api/test-run-cases/${toValue(id)}/timeline`, {
    key: () => `execution-timeline-${toValue(id)}`,
    immediate: toValue(load),
    watch: false,
    dedupe: 'defer',
    getCachedData: reuseWithinRender,
  });
  watch(
    () => [toValue(id), toValue(load)] as const,
    ([, needed]) => {
      if (needed && timeline.status.value !== 'success') void timeline.execute();
    },
  );
  return timeline;
}
