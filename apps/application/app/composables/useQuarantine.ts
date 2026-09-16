/**
 * Quarantine and release a test from wherever its failure appears.
 *
 * Wraps the project quarantine endpoints so the execution page, the cluster
 * page and the run's bulk bar all call them the same way and report the same
 * way. A single-test call toasts its own outcome; the bulk helper leaves the
 * toast to the caller so a run full of red gets one summary line, not one per
 * row.
 */
export function useQuarantine(projectId: MaybeRefOrGetter<string | number | null | undefined>) {
  const toast = useToast();

  function endpoint(): string | null {
    const id = toValue(projectId);
    return id == null || id === '' ? null : `/api/projects/${id}/quarantine`;
  }

  async function quarantine(testCaseId: number, reason: string): Promise<boolean> {
    const base = endpoint();
    if (!base) return false;
    await $fetch(base, { method: 'POST', body: { testCaseId, reason } });
    return true;
  }

  async function release(testCaseId: number): Promise<boolean> {
    const base = endpoint();
    if (!base) return false;
    await $fetch(`${base}/${testCaseId}`, { method: 'DELETE' });
    return true;
  }

  /** Quarantine one test and toast the outcome. Returns whether it succeeded. */
  async function quarantineOne(testCaseId: number, reason: string): Promise<boolean> {
    try {
      await quarantine(testCaseId, reason);
      toast.add({ title: 'Quarantined', color: 'success' });
      return true;
    } catch {
      toast.add({ title: 'Could not quarantine that test', color: 'error' });
      return false;
    }
  }

  /** Release one test and toast the outcome. Returns whether it succeeded. */
  async function releaseOne(testCaseId: number): Promise<boolean> {
    try {
      await release(testCaseId);
      toast.add({ title: 'Released from quarantine', color: 'success' });
      return true;
    } catch {
      toast.add({ title: 'Could not release that test', color: 'error' });
      return false;
    }
  }

  /**
   * Quarantine several tests at once. Runs sequentially so a shared reason and
   * the project's streak anchor stay predictable, and returns the tally so the
   * caller can raise one summary toast.
   */
  async function quarantineMany(
    testCaseIds: number[],
    reasonFor: (testCaseId: number) => string,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    for (const id of testCaseIds) {
      try {
        await quarantine(id, reasonFor(id));
        succeeded++;
      } catch {
        failed++;
      }
    }
    return { succeeded, failed };
  }

  return { quarantineOne, releaseOne, quarantineMany };
}
