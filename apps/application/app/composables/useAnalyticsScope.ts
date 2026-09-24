import { analyticsScopeToQuery, type AnalyticsScope } from '#shared/analytics/scope';
import {
  DEFAULT_ANALYTICS_SCOPE_STATE,
  decodeScopeCookie,
  isDefaultScopeState,
  queryHasScope,
  queryWithoutScope,
  scopeFromState,
  stateFromScope,
  type AnalyticsScopeState,
} from '#shared/analytics/scope-state';
import { parseAnalyticsScope } from '#shared/analytics/scope';
import type { AnalyticsScopeSummary } from '#shared/analytics/types';
import type { AnalyticsWidgetId } from '#shared/analytics/registry';
import type { InjectionKey, Ref } from 'vue';

export { DEFAULT_ANALYTICS_SCOPE_STATE, type AnalyticsScopeState };

/** The viewer's effective time zone and locale, sent with every widget request for calendar periods. */
function viewerContext(): { tz?: string; locale?: string } {
  if (!import.meta.client) return {};
  const prefs = activeLocalePrefs();
  const tz = prefs.timeZone === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : prefs.timeZone;
  const locale = prefs.locale === 'auto' ? navigator.language : prefs.locale;
  return { ...(tz ? { tz } : {}), ...(locale ? { locale } : {}) };
}

/**
 * The `/analytics` page's scope: the URL first, so a copied link shows what
 * its sender saw, then the `piwi-analytics-scope` cookie as the per-browser
 * default (today's cookie shape still reads). Every change writes both.
 * `scopeQuery` is what every widget request sends.
 */
export function useAnalyticsScope() {
  const cookie = useCookie<AnalyticsScopeState>('piwi-analytics-scope', {
    default: () => ({ ...DEFAULT_ANALYTICS_SCOPE_STATE }),
    encode: (v) => JSON.stringify(v),
    decode: (v) => decodeScopeCookie(v),
  });
  const route = useRoute();
  const router = useRouter();

  const initial = queryHasScope(route.query)
    ? stateFromScope(parseAnalyticsScope(route.query as Record<string, unknown>))
    : decodeScopeCookie(cookie.value);
  const state = ref<AnalyticsScopeState>(initial);

  const scope = computed<AnalyticsScope>(() => scopeFromState(state.value));
  const urlQuery = computed(() => analyticsScopeToQuery(scope.value));
  const scopeQuery = computed(() => ({ ...urlQuery.value, ...viewerContext() }));

  function syncUrl() {
    if (!import.meta.client) return;
    const next = { ...queryWithoutScope(route.query as Record<string, unknown>), ...urlQuery.value };
    if (JSON.stringify(next) !== JSON.stringify(route.query)) router.replace({ query: next as any });
  }

  watch(
    state,
    (value) => {
      cookie.value = value;
      syncUrl();
    },
    { deep: true },
  );
  // A default scope keeps the bare `/analytics` address; any other scope is written on arrival.
  onMounted(() => {
    if (!isDefaultScopeState(state.value)) syncUrl();
  });

  return { state, scope, scopeQuery };
}

/**
 * Fetch one analytics widget's data. The query is reactive — changing the
 * scope refetches every mounted widget.
 */
export function useAnalyticsWidget<T>(widget: AnalyticsWidgetId, query: () => Record<string, string>) {
  return useFetch<T>(`/api/analytics/${widget}`, {
    query: computed(query),
    lazy: true,
    server: false,
  });
}

/** The page's resolved scope summary, provided to the widgets that draw markers or name the comparison. */
export const ANALYTICS_SCOPE_SUMMARY: InjectionKey<Ref<AnalyticsScopeSummary | null | undefined>> =
  Symbol('analytics-scope-summary');

/** Fetch how the scope resolves (period dates, notes, markers, test filter options). */
export function useAnalyticsScopeSummary(query: () => Record<string, string>) {
  return useFetch<AnalyticsScopeSummary>('/api/analytics/scope', {
    query: computed(query),
    lazy: true,
    server: false,
  });
}

/** The provided scope summary, or an empty ref outside the analytics page. */
export function injectAnalyticsScopeSummary(): Ref<AnalyticsScopeSummary | null | undefined> {
  return inject(ANALYTICS_SCOPE_SUMMARY, ref(null));
}
