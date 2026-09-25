import { analyticsScopeToQuery, type AnalyticsScope } from '#shared/analytics/scope';
import {
  DEFAULT_ANALYTICS_SCOPE_STATE,
  decodeScopeCookie,
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

export interface AnalyticsScopeOptions {
  /**
   * The dashboard's default scope. Omitted for Overview, whose per-browser
   * default is the `piwi-analytics-scope` cookie; a saved dashboard starts
   * from its own scope and leaves the cookie alone.
   */
  defaultState?: AnalyticsScopeState;
}

/**
 * A dashboard page's scope: the URL first, so a copied link shows what its
 * sender saw, then the default: for Overview the `piwi-analytics-scope`
 * cookie, the per-browser default (today's cookie shape still reads), which
 * every change writes; for another dashboard its own scope. `scopeQuery` is
 * what every widget request sends.
 */
export function useAnalyticsScope(opts: AnalyticsScopeOptions = {}) {
  const cookie = useCookie<AnalyticsScopeState>('piwi-analytics-scope', {
    default: () => ({ ...DEFAULT_ANALYTICS_SCOPE_STATE }),
    encode: (v) => JSON.stringify(v),
    decode: (v) => decodeScopeCookie(v),
  });
  const route = useRoute();
  const router = useRouter();

  const usesCookie = !opts.defaultState;
  const defaultState = opts.defaultState ?? DEFAULT_ANALYTICS_SCOPE_STATE;
  const initial = queryHasScope(route.query)
    ? stateFromScope(parseAnalyticsScope(route.query as Record<string, unknown>))
    : usesCookie
      ? decodeScopeCookie(cookie.value)
      : { ...defaultState };
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
      if (usesCookie) cookie.value = value;
      syncUrl();
    },
    { deep: true },
  );
  // A default scope keeps the bare `/analytics` address; any other scope is
  // written on arrival, once the app has hydrated and the router settled.
  if (import.meta.client) {
    onNuxtReady(() => {
      if (JSON.stringify(state.value) !== JSON.stringify(defaultState)) syncUrl();
    });
  }

  /** Back to the dashboard's default scope. */
  function reset() {
    state.value = { ...defaultState };
  }

  return { state, scope, scopeQuery, defaultState, reset };
}

/**
 * Where a widget reads its data, provided by the dashboard around it: a saved
 * dashboard's widget (`GET /api/analytics/dashboards/[id]/widgets/[key]`,
 * the definition stays on the server) or the editor's unsaved widget
 * (`POST /api/analytics/widgets/preview`). Without one, the widget reads
 * `GET /api/analytics/[widget]`, as on the built-in dashboards.
 */
export type AnalyticsWidgetSource =
  | { mode: 'dashboard'; dashboardId: string; widgetKey: string; refresh: Ref<number> }
  | {
      mode: 'preview';
      widgetKey: string;
      /** The unsaved widget: type, options and scope override. */
      widget: () => { type: string; options?: Record<string, unknown>; scope?: Record<string, unknown> };
      refresh: Ref<number>;
    }
  | { mode: 'type'; widgetKey: string; refresh: Ref<number> };

export const ANALYTICS_WIDGET_SOURCE: InjectionKey<AnalyticsWidgetSource> = Symbol('analytics-widget-source');

/**
 * Fetch one analytics widget's data. The query is reactive — changing the
 * scope refetches every mounted widget. `options` are the widget's options
 * from the dashboard definition, sent as JSON. A dashboard around the widget
 * decides where the data comes from and when it refreshes.
 */
export function useAnalyticsWidget<T>(
  widget: AnalyticsWidgetId,
  query: () => Record<string, string>,
  options?: () => Record<string, unknown> | undefined,
) {
  const source = inject(ANALYTICS_WIDGET_SOURCE, null);
  // One shape whichever route answers: the widget's data, typed by the caller.
  const result = (
    source?.mode === 'dashboard'
      ? useFetch<T>(`/api/analytics/dashboards/${source.dashboardId}/widgets/${source.widgetKey}`, {
          key: `dashboard-widget-${source.dashboardId}-${source.widgetKey}`,
          query: computed(query),
          lazy: true,
          server: false,
        })
      : source?.mode === 'preview'
        ? useAsyncData<T>(
            `preview-widget-${source.widgetKey}`,
            () =>
              $fetch<T>('/api/analytics/widgets/preview', {
                method: 'POST',
                body: { widget: source.widget(), scope: query() },
              }),
            {
              watch: [computed(() => JSON.stringify([source.widget(), query()]))],
              lazy: true,
              server: false,
            },
          )
        : useTypeWidget<T>(widget, query, options)
  ) as ReturnType<typeof useTypeWidget<T>>;
  if (source) watch(source.refresh, () => void result.refresh());
  return result;
}

function useTypeWidget<T>(
  widget: AnalyticsWidgetId,
  query: () => Record<string, string>,
  options: (() => Record<string, unknown> | undefined) | undefined,
) {
  return useFetch<T>(`/api/analytics/${widget}`, {
    query: computed(() => {
      const value = options?.();
      return value && Object.keys(value).length > 0 ? { ...query(), options: JSON.stringify(value) } : query();
    }),
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
