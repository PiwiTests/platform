import { analyticsScopeToQuery, DEFAULT_ANALYTICS_DAYS, type AnalyticsScope } from '#shared/analytics/scope';
import type { AnalyticsWidgetId } from '#shared/analytics/registry';

export interface AnalyticsScopeState {
  days: number;
  /** Selected project ids; empty = every project the caller can see. */
  projectIds: number[];
  /** Selected environments; empty = every environment. */
  environments: string[];
  /** Selected branches; empty = every branch. */
  branches: string[];
  fullRunsOnly: boolean;
}

export const DEFAULT_ANALYTICS_SCOPE_STATE: AnalyticsScopeState = {
  days: DEFAULT_ANALYTICS_DAYS,
  projectIds: [],
  environments: [],
  branches: [],
  fullRunsOnly: true,
};

/**
 * The `/analytics` page's global filter state (persisted per user in a
 * cookie, SSR-safe) plus the query object every widget fetch derives from.
 */
export function useAnalyticsScope() {
  const state = useCookie<AnalyticsScopeState>('piwi-analytics-scope', {
    default: () => ({ ...DEFAULT_ANALYTICS_SCOPE_STATE }),
    encode: (v) => JSON.stringify(v),
    decode: (v) => {
      try {
        return v
          ? { ...DEFAULT_ANALYTICS_SCOPE_STATE, ...(JSON.parse(v) as Partial<AnalyticsScopeState>) }
          : { ...DEFAULT_ANALYTICS_SCOPE_STATE };
      } catch {
        return { ...DEFAULT_ANALYTICS_SCOPE_STATE };
      }
    },
  });

  const scope = computed<AnalyticsScope>(() => ({
    days: state.value.days,
    projectIds: state.value.projectIds.length > 0 ? state.value.projectIds : undefined,
    environments: state.value.environments.length > 0 ? state.value.environments : undefined,
    branches: state.value.branches.length > 0 ? state.value.branches : undefined,
    fullRunsOnly: state.value.fullRunsOnly,
  }));

  const scopeQuery = computed(() => analyticsScopeToQuery(scope.value));

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
