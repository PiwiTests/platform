/**
 * Saves part of a project's settings through `PATCH /api/projects/:id` — the
 * endpoint leaves every field the body omits unchanged — with a toast either way.
 * `save` resolves true when the change was stored.
 */
export function useProjectPatch(projectId: MaybeRefOrGetter<number>) {
  const toast = useToast();
  const saving = ref(false);

  async function save(body: Record<string, unknown>, successTitle: string): Promise<boolean> {
    saving.value = true;
    try {
      await $fetch<unknown>(`/api/projects/${toValue(projectId)}`, { method: 'PATCH', body });
      toast.add({ title: successTitle, color: 'success' });
      return true;
    } catch (error) {
      toast.add({ title: 'Couldn’t save the settings', description: errorMessage(error), color: 'error' });
      return false;
    } finally {
      saving.value = false;
    }
  }

  return { saving, save };
}
