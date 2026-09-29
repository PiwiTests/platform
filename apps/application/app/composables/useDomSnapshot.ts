import type { MaybeRefOrGetter } from 'vue';
import { buildReadonlyDocument } from '~/utils/snapshot-picker-script';

/** One trace action's snapshot moment: the page before it ran, or after it. */
export interface DomSnapshotMoment {
  callId: string;
  phase: 'before' | 'after';
}

interface DomSnapshotResponse {
  status: 'ok' | 'no-trace' | 'no-snapshot';
  html?: string;
  snapshotName?: string;
  viewport?: { width: number; height: number };
}

/**
 * An execution's DOM snapshot: whether one exists, its viewport and its lean
 * HTML (`dom-snapshot`), and where the rendered page loads from. The served app
 * (web and desktop) loads it from `dom-snapshot-frame`, which embeds the trace's
 * stylesheets and images and carries its own `sandbox allow-scripts` CSP; a
 * `srcdoc` frame would inherit the desktop page's `strict-dynamic` policy, which
 * blocks the inline measure script. The demo has no server, so it renders the
 * HTML through `srcdoc`. `at` names one trace action's snapshot to render first
 * (the one a screenshot of the same moment was taken at); without it, the
 * failure-time snapshot. Nothing is fetched until `ready`, so a caller that
 * works `at` out from another request asks once, for the right snapshot.
 */
export function useDomSnapshot(
  testRunsCaseId: MaybeRefOrGetter<number>,
  at: MaybeRefOrGetter<DomSnapshotMoment | null> = null,
  ready: MaybeRefOrGetter<boolean> = true,
) {
  const config = useRuntimeConfig();
  const isDemo = !!config.public.demoMode;
  const apiBase = (config.app.baseURL || '/').replace(/\/$/, '');

  const query = computed<Record<string, string>>(() => {
    const moment = toValue(at);
    const params: Record<string, string> = {};
    if (moment) Object.assign(params, { callId: moment.callId, phase: moment.phase });
    return params;
  });

  const {
    data: snapshot,
    pending,
    execute,
  } = useFetch<DomSnapshotResponse>(() => `/api/test-run-cases/${toValue(testRunsCaseId)}/dom-snapshot`, {
    lazy: true,
    query,
    immediate: toValue(ready),
    watch: false,
  });
  watch([() => toValue(testRunsCaseId), query, () => toValue(ready)], () => {
    if (toValue(ready)) void execute();
  });
  const html = computed(() => snapshot.value?.html ?? null);
  const hasDom = computed(() => snapshot.value?.status === 'ok' && !!html.value);
  const viewport = computed(() => snapshot.value?.viewport ?? null);

  const frameSrc = computed(() => {
    if (isDemo || !hasDom.value) return undefined;
    const params = new URLSearchParams({ mode: 'readonly', ...query.value });
    return `${apiBase}/api/test-run-cases/${toValue(testRunsCaseId)}/dom-snapshot-frame?${params}`;
  });
  const srcDoc = computed(() =>
    isDemo && import.meta.client && html.value ? buildReadonlyDocument(html.value) : undefined,
  );

  return { snapshot, pending, html, hasDom, viewport, frameSrc, srcDoc };
}
