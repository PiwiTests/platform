import type { MaybeRefOrGetter } from 'vue';

/**
 * The one place a failure cluster is marked resolved or reopened: the status
 * PATCH, the success / error toast and the caller's refresh. Both failure pages
 * (through the next-step line) and `ClusterStateLine` (its reconcile action)
 * share it, so the wording and the request live once.
 *
 * `currentNote` is opt-in: pass it to carry the existing triage note through the
 * PATCH (the status endpoint rewrites the note, so an omitted note clears it);
 * leave it out where the caller intentionally sends none.
 */
export function useClusterTriage(
  clusterId: MaybeRefOrGetter<number | null | undefined>,
  opts?: { currentNote?: () => string | null | undefined; onSaved?: () => void | Promise<void> },
) {
  const toast = useToast();

  async function setClusterStatus(status: 'open' | 'resolved') {
    const id = toValue(clusterId);
    if (id == null) return;
    try {
      await $fetch(`/api/failure-clusters/${id}/status`, {
        method: 'PATCH',
        body: { status, triageNote: opts?.currentNote ? (opts.currentNote() ?? null) : undefined },
      });
      toast.add({
        title: status === 'resolved' ? 'Cluster marked resolved' : 'Cluster reopened',
        color: 'success',
      });
      await opts?.onSaved?.();
    } catch {
      toast.add({ title: 'Could not update the cluster', color: 'error' });
    }
  }

  return { setClusterStatus };
}
