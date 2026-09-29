/**
 * Which failure-timeline item types are hidden: a per-browser preference kept
 * in localStorage (`piwi-timeline-hidden-types`), shared by every execution and
 * every open tab.
 *
 * The server cannot read localStorage, so the choice is mirrored into a cookie
 * of the same name, present only while something is hidden. The server and the
 * hydrating client render from the cookie, so a hard load arrives already
 * filtered; once mounted, localStorage speaks and the cookie follows it. A
 * malformed value in either reads as nothing hidden.
 */
import type { TimelineLane } from '#shared/failure-timeline';
import { onlyHiddenTypes, parseHiddenTypes, toggleHiddenType } from '~/utils/timeline-type-filter';

const STORAGE_KEY = 'piwi-timeline-hidden-types';
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function useTimelineTypeFilter() {
  const stored = useLocalStorage<TimelineLane[]>(STORAGE_KEY, [], { initOnMounted: true, writeDefaults: false });
  const mirror = useCookie<unknown>(STORAGE_KEY, { default: () => null, maxAge: ONE_YEAR_S, sameSite: 'lax' });

  function writeMirror(hidden: TimelineLane[]): void {
    mirror.value = hidden.length > 0 ? hidden : null;
  }

  const mounted = ref(false);
  onMounted(() => {
    mounted.value = true;
    writeMirror(parseHiddenTypes(stored.value));
  });

  /** The stored hidden types, as saved — `effectiveHiddenTypes` says which apply to an execution. */
  const hidden = computed(() => parseHiddenTypes(mounted.value ? stored.value : mirror.value));

  function save(next: TimelineLane[]): void {
    stored.value = next;
    writeMirror(next);
  }

  return {
    hidden,
    /** Hide a shown type, or show a hidden one, among the `present` types. */
    toggle: (type: TimelineLane, present: readonly TimelineLane[]) =>
      save(toggleHiddenType(hidden.value, type, present)),
    /** Show only `type`. */
    only: (type: TimelineLane) => save(onlyHiddenTypes(type)),
    showAll: () => save([]),
  };
}
