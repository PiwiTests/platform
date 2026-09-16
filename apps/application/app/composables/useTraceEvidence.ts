import type { TraceCallStackResponse, TraceNetworkResponse } from '~~/types/api';

/**
 * Lazy client-side loaders for the trace-derived "go deeper" evidence (full
 * call stack, full network trace). Fetch runs on the client only — the cards
 * are progressive enhancement over the reporter-captured baseline, so SSR
 * renders the baseline and the trace views stream in after mount. When
 * `enabled` flips true later (a trace arriving mid-run over the live SSE
 * stream), an auto loader re-fires and a manual one re-fires only if it was
 * already requested.
 */
function useTraceEndpoint<T extends { status: string }>(
  path: () => string | null,
  enabled: MaybeRefOrGetter<boolean>,
  auto: boolean,
) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const pending = ref(false);
  const requested = ref(false);

  async function load() {
    if (!import.meta.client) return;
    const url = path();
    if (!url || !toValue(enabled) || pending.value) return;
    requested.value = true;
    pending.value = true;
    try {
      data.value = await $fetch<T>(url);
    } catch {
      data.value = null;
    } finally {
      pending.value = false;
    }
  }

  onMounted(() => {
    watch(
      () => toValue(enabled),
      (on) => {
        if (on && (auto || requested.value) && !data.value) load();
      },
      { immediate: true },
    );
  });

  return { data, pending, load };
}

/** Full call stack of the failing action, from the stored trace. */
export function useTraceCallStack(
  runId: MaybeRefOrGetter<number | null | undefined>,
  testRunsCaseId: MaybeRefOrGetter<number | null | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
  options: { auto?: boolean } = {},
) {
  return useTraceEndpoint<TraceCallStackResponse>(
    () => {
      const run = toValue(runId);
      const caseId = toValue(testRunsCaseId);
      return run && caseId ? `/api/test-run-cases/${caseId}/trace-stacks` : null;
    },
    enabled,
    options.auto ?? true,
  );
}

/** Full network activity recorded in the stored trace. */
export function useTraceNetwork(
  runId: MaybeRefOrGetter<number | null | undefined>,
  testRunsCaseId: MaybeRefOrGetter<number | null | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
  options: { auto?: boolean } = {},
) {
  return useTraceEndpoint<TraceNetworkResponse>(
    () => {
      const run = toValue(runId);
      const caseId = toValue(testRunsCaseId);
      return run && caseId ? `/api/test-run-cases/${caseId}/trace-network` : null;
    },
    enabled,
    options.auto ?? false,
  );
}
