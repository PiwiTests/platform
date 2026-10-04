import type { TrackerField } from '#shared/integrations/fields';

/**
 * The fields of a tracker's create screen for a connection, project and issue
 * type, reloaded whenever one of the three changes and cleared while any is
 * unset. The binding form and the create modal both read them to ask for the
 * fields the tracker requires.
 */
export function useTrackerFields(
  connectionId: () => number | null | undefined,
  projectKey: () => string | null | undefined,
  issueType: () => string | null | undefined,
) {
  const fields = ref<TrackerField[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Increments per request, so an older answer never overwrites a newer one. */
  let generation = 0;

  async function load() {
    const id = connectionId();
    const key = projectKey();
    const type = issueType();
    const current = ++generation;
    if (!id || !key || !type) {
      fields.value = [];
      error.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const res = await $fetch<{ fields: TrackerField[] }>(
        `/api/integrations/connections/${id}/projects/${encodeURIComponent(key)}/issue-types/${encodeURIComponent(type)}/fields`,
      );
      if (current === generation) fields.value = res.fields;
    } catch (err) {
      if (current === generation) {
        fields.value = [];
        error.value = errorMessage(err, 'Could not read the fields from Jira');
      }
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  watch([connectionId, projectKey, issueType], () => void load(), { immediate: true });

  return { fields, loading, error, reload: load };
}
