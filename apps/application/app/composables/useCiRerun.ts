import type { MaybeRefOrGetter } from 'vue';

/** A cluster's CI re-run availability and last dispatch, from `/rerun`. */
export interface RerunInfo {
  available: boolean;
  reason: string | null;
  provider: string | null;
  enabled: boolean;
  hasToken: boolean;
  lastDispatch: { provider: string; url: string; args: string; at: number; byName: string | null } | null;
}

/**
 * Dispatch a CI re-run of a cluster's affected tests. Both failure pages fetch
 * the `RerunInfo` themselves (their SSR strategies differ) but share this POST
 * and its toasts; the caller refreshes the info afterwards.
 */
export function useCiRerun(clusterId: MaybeRefOrGetter<number | null | undefined>, refreshRerun: () => unknown) {
  const toast = useToast();
  const rerunning = ref(false);

  async function triggerRerun() {
    const id = toValue(clusterId);
    if (id == null || rerunning.value) return;
    rerunning.value = true;
    try {
      const res = await $fetch<{ ok: boolean; message?: string; dispatch?: { url: string } }>(
        `/api/failure-clusters/${id}/rerun`,
        { method: 'POST' },
      );
      if (res.ok && res.dispatch) {
        toast.add({
          title: 'CI re-run dispatched',
          description: 'The affected tests are re-running.',
          color: 'success',
        });
        await refreshRerun();
      } else {
        toast.add({ title: 'CI re-run not started', description: res.message ?? 'Not available.', color: 'warning' });
      }
    } catch (e: unknown) {
      const message = (e as { data?: { message?: string }; message?: string })?.data?.message ?? 'Dispatch failed.';
      toast.add({ title: 'CI re-run failed', description: message, color: 'error' });
    } finally {
      rerunning.value = false;
    }
  }

  return { rerunning, triggerRerun };
}
