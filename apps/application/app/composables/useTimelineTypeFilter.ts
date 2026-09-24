/**
 * Which failure-timeline item types are hidden: a per-browser preference kept
 * in localStorage (`piwi-timeline-hidden-types`), shared by every execution and
 * every open tab.
 *
 * The server cannot read localStorage, so the choice is mirrored into a cookie
 * of the same name. The server and the hydrating client render from the cookie,
 * so a hard load arrives already filtered instead of reflowing; once mounted,
 * localStorage speaks and the cookie is brought in line with it. A malformed
 * value in either reads as nothing hidden.
 */
import type { TimelineLane } from '#shared/failure-timeline';
import { parseHiddenTypes, soloHiddenType, toggleHiddenType } from '~/utils/timeline-type-filter';

const STORAGE_KEY = 'piwi-timeline-hidden-types';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function useTimelineTypeFilter() {
  const stored = useLocalStorage<TimelineLane[]>(STORAGE_KEY, [], { initOnMounted: true, writeDefaults: false });
  const mirror = useCookie<unknown>(STORAGE_KEY, { default: () => [], maxAge: ONE_YEAR_S, sameSite: 'lax' });

  const mounted = ref(false);
  onMounted(() => {
    mounted.value = true;
    mirror.value = parseHiddenTypes(stored.value);
  });

  const hidden = computed(() => parseHiddenTypes(mounted.value ? stored.value : mirror.value));

  function save(next: TimelineLane[]): void {
    stored.value = next;
    mirror.value = next;
  }

  return {
    hidden,
    /** Hide a shown type, or show a hidden one. */
    toggle: (type: TimelineLane) => save(toggleHiddenType(hidden.value, type)),
    /** Show only `type` among the `present` ones — or everything, when it already is the only one. */
    solo: (type: TimelineLane, present: readonly TimelineLane[]) => save(soloHiddenType(hidden.value, type, present)),
    showAll: () => save([]),
  };
}
