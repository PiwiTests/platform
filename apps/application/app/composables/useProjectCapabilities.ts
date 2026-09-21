import type { CapabilityId, CapabilityState, ProjectDecision } from '#shared/capabilities';
import type { CapabilityStateItem, CapabilityStates } from '#shared/handlers/capabilities';

const projectFetches = new Map<number, Promise<CapabilityStateItem[]>>();

/**
 * The resolved state of every optional capability for one project: the
 * project's evidence and decision over the instance's. Fetched once per project
 * per page session. `state(id)` is the resolved state, `isHidden(id)` is true
 * when declined or not applicable, `canDecide` gates the controls to
 * administrators, and `decide` writes a project decision (`enabled` overrides an
 * instance decline; `null` clears it).
 */
export function useProjectCapabilities(projectId: number) {
  const items = useState<CapabilityStateItem[] | null>(`capabilities-project-${projectId}`, () => null);
  const { canSeeAdmin } = useAuth();

  async function load() {
    if (items.value !== null) return;
    let pending = projectFetches.get(projectId);
    if (!pending) {
      pending = $fetch<CapabilityStates>(`/api/projects/${projectId}/capabilities`)
        .then((r) => r.items)
        .catch(() => []);
      projectFetches.set(projectId, pending);
    }
    items.value = await pending;
  }

  if (import.meta.client) load();

  const stateMap = computed(() => {
    const map = new Map<CapabilityId, CapabilityState>();
    for (const item of items.value ?? []) map.set(item.id, item.state);
    return map;
  });

  const state = (id: CapabilityId): CapabilityState => stateMap.value.get(id) ?? 'undecided';
  const isHidden = (id: CapabilityId): boolean => state(id) === 'declined' || state(id) === 'not-applicable';

  async function decide(id: CapabilityId, decision: ProjectDecision | null) {
    const res = await $fetch<CapabilityStates>(`/api/projects/${projectId}/capabilities`, {
      method: 'PATCH',
      body: { decisions: { [id]: decision } },
    });
    projectFetches.set(projectId, Promise.resolve(res.items));
    items.value = res.items;
  }

  return { capabilities: items, state, isHidden, canDecide: canSeeAdmin, decide };
}
