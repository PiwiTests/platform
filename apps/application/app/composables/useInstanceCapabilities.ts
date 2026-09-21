import type { CapabilityId, CapabilityState, InstanceDecision } from '#shared/capabilities';
import type { CapabilityStateItem, CapabilityStates } from '#shared/handlers/capabilities';

let instanceFetch: Promise<CapabilityStateItem[]> | null = null;

/**
 * The resolved instance-level state of every optional capability, fetched once
 * and shared. `state(id)` is the resolved state, `isHidden(id)` is true when a
 * capability is declined or not applicable (so a surface renders nothing),
 * `canDecide` gates the decline controls to administrators, and `decide` writes
 * a decision (`null` clears it).
 */
export function useInstanceCapabilities() {
  const items = useState<CapabilityStateItem[] | null>('capabilities-instance', () => null);
  const { canSeeAdmin } = useAuth();

  async function load() {
    if (items.value !== null) return;
    if (!instanceFetch) {
      instanceFetch = $fetch<CapabilityStates>('/api/capabilities')
        .then((r) => r.items)
        .catch(() => []);
    }
    items.value = await instanceFetch;
  }

  if (import.meta.client) load();

  const stateMap = computed(() => {
    const map = new Map<CapabilityId, CapabilityState>();
    for (const item of items.value ?? []) map.set(item.id, item.state);
    return map;
  });

  const state = (id: CapabilityId): CapabilityState => stateMap.value.get(id) ?? 'undecided';
  const isHidden = (id: CapabilityId): boolean => state(id) === 'declined' || state(id) === 'not-applicable';

  async function decide(id: CapabilityId, decision: InstanceDecision | null) {
    const res = await $fetch<CapabilityStates>('/api/capabilities', {
      method: 'PATCH',
      body: { decisions: { [id]: decision } },
    });
    instanceFetch = Promise.resolve(res.items);
    items.value = res.items;
  }

  return { capabilities: items, state, isHidden, canDecide: canSeeAdmin, decide };
}
