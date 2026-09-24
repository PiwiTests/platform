/**
 * Keep a run forever, or release it back to retention.
 *
 * Wraps `PATCH /api/test-runs/:id` so the run page and the project's runs table
 * keep and release the same way and toast the same outcome. Releasing needs
 * the administrator role; `canRelease` mirrors that rule for the UI.
 */
export function useRunKeep() {
  const toast = useToast();
  const { canSeeAdmin } = useAuth();

  async function keep(runId: number, reason: string | null): Promise<boolean> {
    try {
      await $fetch(`/api/test-runs/${runId}`, {
        method: 'PATCH',
        body: { keep: true, keepReason: reason?.trim() || null },
      });
      toast.add({ title: `Run #${runId} is kept forever`, color: 'success' });
      return true;
    } catch (error: unknown) {
      toast.add({ title: 'Could not keep the run', description: errorMessage(error), color: 'error' });
      return false;
    }
  }

  async function release(runId: number): Promise<boolean> {
    try {
      await $fetch(`/api/test-runs/${runId}`, { method: 'PATCH', body: { keep: false } });
      toast.add({ title: `Run #${runId} is no longer kept`, description: 'Retention applies to it again.' });
      return true;
    } catch (error: unknown) {
      toast.add({ title: 'Could not release the run', description: errorMessage(error), color: 'error' });
      return false;
    }
  }

  return { keep, release, canRelease: canSeeAdmin };
}
