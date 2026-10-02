/**
 * Form state seeded from stored values. It re-seeds only when the stored values
 * change (a save, an edit elsewhere), never on a refetch that returns the same
 * values, so a background refresh keeps the edits not saved yet. `dirty` is true
 * while the form differs from the stored values.
 *
 * `stored` must return plain JSON data: the form is a deep copy of it.
 */
export function useStoredForm<T>(stored: () => T) {
  const snapshot = computed(() => JSON.stringify(stored()));
  const state = ref(JSON.parse(snapshot.value)) as Ref<T>;
  watch(snapshot, (next) => {
    state.value = JSON.parse(next);
  });
  const dirty = computed(() => JSON.stringify(state.value) !== snapshot.value);
  return { state, dirty };
}
