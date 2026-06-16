import type { InjectionKey, Ref, ComputedRef } from 'vue';
import type { FailureDiagnosis } from '~~/server/database/schema';
import type { DiagnosisContextCoverage, ScmChanges } from '~~/types/api';

/**
 * Shared state + actions for the failure-cluster diagnosis page, owned by the
 * page and consumed by `ClusterInvestigation` and `ClusterDiagnosis` via
 * provide/inject. Centralizing it here means the `/context` and `/diagnosis`
 * endpoints are each fetched once (both panels previously fetched them
 * separately), and the baseline/selected-commit state no longer round-trips
 * through page props/events.
 */

export interface DiagnoseImage {
  name: string;
  mediaType: string;
  data: string;
}

export interface ClusterDiagnosisStore {
  clusterId: number;

  // Investigation state
  baseCommit: Ref<string>;
  savedBaseCommit: Ref<string>;
  selectedCommitShas: Ref<string[]>;
  baseCommitIsPinned: ComputedRef<boolean>;

  // Shared context (single fetch, used by both panels)
  contextText: Ref<string | null>;
  coverage: Ref<DiagnosisContextCoverage | null>;
  scmChanges: Ref<ScmChanges | null>;
  contextLoading: Ref<boolean>;
  refreshContext: () => Promise<void>;

  // Diagnosis state
  diagnosis: Ref<FailureDiagnosis | null>;
  posting: Ref<boolean>;
  runDiagnosis: (opts?: { force?: boolean; additionalContext?: string; images?: DiagnoseImage[] }) => Promise<void>;
}

const CLUSTER_DIAGNOSIS_KEY: InjectionKey<ClusterDiagnosisStore> = Symbol('cluster-diagnosis');

function createClusterDiagnosisStore(clusterId: number): ClusterDiagnosisStore {
  const toast = useToast();

  const baseCommit = ref('');
  const savedBaseCommit = ref('');
  const selectedCommitShas = ref<string[]>([]);
  const baseCommitIsPinned = computed(() => !!savedBaseCommit.value);

  const contextText = ref<string | null>(null);
  const coverage = ref<DiagnosisContextCoverage | null>(null);
  const scmChanges = ref<ScmChanges | null>(null);
  const contextLoading = ref(false);

  const diagnosis = ref<FailureDiagnosis | null>(null);
  const posting = ref(false);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let baseCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let initializing = true;

  function buildContextQuery() {
    const query: Record<string, string | string[]> = {};
    if (baseCommit.value.trim()) query.baseCommit = baseCommit.value.trim();
    if (selectedCommitShas.value.length) query.selectedCommitShas = selectedCommitShas.value;
    return query;
  }

  async function refreshContext() {
    contextLoading.value = true;
    try {
      const res = await $fetch<{ context: string; coverage: DiagnosisContextCoverage; scmChanges: ScmChanges | null }>(
        `/api/failure-clusters/${clusterId}/context`,
        { query: buildContextQuery() },
      );
      contextText.value = res.context;
      coverage.value = res.coverage;
      scmChanges.value = res.scmChanges ?? null;
    } catch {
      contextText.value = '(failed to load context)';
      coverage.value = null;
      scmChanges.value = null;
    } finally {
      contextLoading.value = false;
    }
  }

  async function persistBaseCommit(sha: string) {
    try {
      await $fetch(`/api/failure-clusters/${clusterId}/base-commit`, {
        method: 'PATCH',
        body: { commit: sha || null },
      });
      savedBaseCommit.value = sha;
    } catch {
      /* ignore — non-critical */
    }
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPoll() {
    if (pollTimer) return;
    let elapsed = 0;
    pollTimer = setInterval(async () => {
      elapsed += 3000;
      await fetchDiagnosis();
      if (!diagnosis.value || diagnosis.value.status !== 'running' || elapsed >= 120_000) stopPoll();
    }, 3000);
  }

  async function fetchDiagnosis() {
    try {
      const res = await $fetch<{ diagnosis: FailureDiagnosis | null; manualBaseCommit: string | null }>(
        `/api/failure-clusters/${clusterId}/diagnosis`,
      );
      diagnosis.value = res.diagnosis;
    } catch {
      /* ignore */
    }
  }

  async function runDiagnosis(opts: { force?: boolean; additionalContext?: string; images?: DiagnoseImage[] } = {}) {
    posting.value = true;
    try {
      const url = opts.force
        ? `/api/failure-clusters/${clusterId}/diagnose?force=true`
        : `/api/failure-clusters/${clusterId}/diagnose`;
      const body: Record<string, unknown> = {};
      if (opts.additionalContext) body.additionalContext = opts.additionalContext;
      if (baseCommit.value.trim()) body.baseCommit = baseCommit.value.trim();
      if (selectedCommitShas.value.length) body.selectedCommitShas = selectedCommitShas.value;
      if (opts.images?.length) body.images = opts.images;
      diagnosis.value = await $fetch<FailureDiagnosis>(url, {
        method: 'POST',
        body: Object.keys(body).length ? body : undefined,
      });
      if (diagnosis.value?.status === 'running') startPoll();
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 409) startPoll();
      else
        toast.add({ title: 'Diagnosis failed', description: String((err as Error)?.message ?? err), color: 'error' });
    } finally {
      posting.value = false;
    }
  }

  // Re-fetch context when the baseline (debounced) or selected commits change,
  // and persist a changed baseline. Skipped during initial hydration.
  watch(baseCommit, (val) => {
    if (initializing) return;
    if (baseCommitTimer) clearTimeout(baseCommitTimer);
    baseCommitTimer = setTimeout(() => refreshContext(), 900);
    if (val !== savedBaseCommit.value) persistBaseCommit(val);
  });

  watch(
    selectedCommitShas,
    () => {
      if (initializing) return;
      refreshContext();
    },
    { deep: true },
  );

  watch(diagnosis, (val) => {
    if (val?.status === 'running') startPoll();
    else stopPoll();
  });

  // Initial hydration: one /diagnosis call gives both the stored diagnosis and
  // the pinned baseline; then one /context call.
  onMounted(async () => {
    try {
      const res = await $fetch<{ diagnosis: FailureDiagnosis | null; manualBaseCommit: string | null }>(
        `/api/failure-clusters/${clusterId}/diagnosis`,
      );
      diagnosis.value = res.diagnosis;
      if (res.manualBaseCommit) {
        savedBaseCommit.value = res.manualBaseCommit;
        baseCommit.value = res.manualBaseCommit;
      }
    } catch {
      /* ignore */
    }
    initializing = false;
    refreshContext();
    if (diagnosis.value?.status === 'running') startPoll();
  });

  onScopeDispose(() => {
    stopPoll();
    if (baseCommitTimer) clearTimeout(baseCommitTimer);
  });

  return {
    clusterId,
    baseCommit,
    savedBaseCommit,
    selectedCommitShas,
    baseCommitIsPinned,
    contextText,
    coverage,
    scmChanges,
    contextLoading,
    refreshContext,
    diagnosis,
    posting,
    runDiagnosis,
  };
}

/** Create the store and provide it to descendant components. Call once on the page. */
export function provideClusterDiagnosis(clusterId: number): ClusterDiagnosisStore {
  const store = createClusterDiagnosisStore(clusterId);
  provide(CLUSTER_DIAGNOSIS_KEY, store);
  return store;
}

/** Inject the cluster-diagnosis store provided by the page. */
export function useClusterDiagnosis(): ClusterDiagnosisStore {
  const store = inject(CLUSTER_DIAGNOSIS_KEY);
  if (!store) throw new Error('useClusterDiagnosis() must be used under a page that called provideClusterDiagnosis()');
  return store;
}
