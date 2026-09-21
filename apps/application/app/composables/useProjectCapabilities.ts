import type { CapabilityId, CapabilityState, ProjectDecision } from '#shared/capabilities';
import type { CapabilityStateItem, CapabilityStates } from '#shared/handlers/capabilities';

/**
 * The resolved state of every optional capability for one project: the
 * project's evidence and decision over the instance's.
 *
 * Backed by `useAsyncData` keyed `capabilities-project-<id>`, so the states are
 * fetched during SSR and hydrated from the payload rather than fetched only on
 * the client. Call it at the top of `<script setup>` (and `await` it, as
 * `SubscribeBell.vue` does with `useFetch`) so a declined capability's chrome is
 * absent from the first render instead of flashing in and disappearing after
 * hydration. Repeated calls for the same project share one fetch through the key.
 *
 * `state(id)` is the resolved state, `isHidden(id)` is true when declined or not
 * applicable, `canDecide` gates the controls to administrators, `decide` writes
 * one decision and `decideMany` writes several at once (`enabled` overrides an
 * instance decline; `null` clears a decision). A read failure resolves to an
 * empty list.
 */
export function useProjectCapabilities(projectId: number) {
  const { canSeeAdmin } = useAuth();

  const { data: items } = useAsyncData<CapabilityStateItem[]>(
    `capabilities-project-${projectId}`,
    () =>
      $fetch<CapabilityStates>(`/api/projects/${projectId}/capabilities`)
        .then((r) => r.items)
        .catch(() => []),
    { default: () => [] },
  );

  const stateMap = computed(() => {
    const map = new Map<CapabilityId, CapabilityState>();
    for (const item of items.value ?? []) map.set(item.id, item.state);
    return map;
  });

  const state = (id: CapabilityId): CapabilityState => stateMap.value.get(id) ?? 'undecided';
  const isHidden = (id: CapabilityId): boolean => state(id) === 'declined' || state(id) === 'not-applicable';

  async function decideMany(decisions: Partial<Record<CapabilityId, ProjectDecision | null>>) {
    const res = await $fetch<CapabilityStates>(`/api/projects/${projectId}/capabilities`, {
      method: 'PATCH',
      body: { decisions },
    });
    items.value = res.items;
  }

  const decide = (id: CapabilityId, decision: ProjectDecision | null) => decideMany({ [id]: decision });

  return { capabilities: items, state, isHidden, canDecide: canSeeAdmin, decide, decideMany };
}
