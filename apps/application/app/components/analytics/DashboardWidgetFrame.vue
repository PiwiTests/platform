<script setup lang="ts">
/**
 * One widget of a dashboard: it tells the widget where to read its data (the
 * generic widget route for a built-in dashboard, the saved dashboard's own
 * widget route, or the editor's preview of the unsaved definition) and when
 * to refresh, and renders the notice of a widget a later release removed.
 */
import { getAnalyticsWidget } from '#shared/analytics/registry';
import { analyticsScopeToQuery, type AnalyticsScope } from '#shared/analytics/scope';
import { applyWidgetScope, type ResolvedDashboardWidget } from '#shared/analytics/dashboards';
import { CONFIGURABLE_WIDGETS, WIDGET_COMPONENTS } from '~/utils/analytics-widgets';

const props = defineProps<{
  widget: ResolvedDashboardWidget;
  /** Where the data comes from: see `AnalyticsWidgetSource`. */
  mode: 'type' | 'dashboard' | 'preview';
  dashboardId: string;
  /** The page's scope and its query (with the viewer's time zone and locale). */
  scope: AnalyticsScope;
  query: Record<string, string>;
  /** Bumped to refetch the widget. */
  refresh: number;
  testFilterActive: boolean;
}>();

const refreshRef = toRef(props, 'refresh');
provide(
  ANALYTICS_WIDGET_SOURCE,
  props.mode === 'dashboard'
    ? { mode: 'dashboard', dashboardId: props.dashboardId, widgetKey: props.widget.key, refresh: refreshRef }
    : props.mode === 'preview'
      ? {
          mode: 'preview',
          widgetKey: props.widget.key,
          refresh: refreshRef,
          widget: () =>
            props.widget.available
              ? {
                  type: props.widget.type,
                  options: props.widget.options,
                  ...(props.widget.scope ? { scope: props.widget.scope as Record<string, unknown> } : {}),
                }
              : { type: 'text' },
        }
      : { mode: 'type', widgetKey: props.widget.key, refresh: refreshRef },
);

/**
 * The request's query. A built-in dashboard's widget reads the generic route,
 * so its own period or narrower filters are applied here; a saved or edited
 * widget sends the page scope and the server applies the widget's.
 */
const widgetQuery = computed<Record<string, string>>(() => {
  const w = props.widget;
  if (props.mode !== 'type' || !w.available || !w.scope) return props.query;
  const { tz, locale } = props.query;
  return {
    ...analyticsScopeToQuery(applyWidgetScope(props.scope, w.scope)),
    ...(tz ? { tz } : {}),
    ...(locale ? { locale } : {}),
  };
});

const componentProps = computed(() => {
  const w = props.widget;
  if (!w.available) return {};
  // The registry title is the widget's fallback; each widget words its own better default from its data.
  const title = w.title === getAnalyticsWidget(w.type).title ? undefined : w.title;
  return CONFIGURABLE_WIDGETS.has(w.type)
    ? { query: widgetQuery.value, options: w.options, title }
    : { query: widgetQuery.value };
});

/** Widgets that count no test at all: a note and the timeline markers. */
const NOT_ABOUT_TESTS = new Set(['text', 'markers']);

const ignoresTestFilter = computed(
  () =>
    props.widget.available &&
    props.testFilterActive &&
    !NOT_ABOUT_TESTS.has(props.widget.type) &&
    !getAnalyticsWidget(props.widget.type).testFilters,
);
</script>

<template>
  <div :data-widget-key="widget.key">
    <template v-if="widget.available">
      <p v-if="ignoresTestFilter" class="text-xs text-muted mb-1">
        {{ widget.title }} is not narrowed by the test filter.
      </p>
      <component :is="WIDGET_COMPONENTS[widget.type]" v-bind="componentProps" />
    </template>
    <EmptyState v-else icon="i-lucide-circle-slash" :text="widget.reason" />
  </div>
</template>
