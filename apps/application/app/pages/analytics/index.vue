<script setup lang="ts">
/**
 * `/analytics` opens the viewer's default dashboard: the one they picked in
 * this browser, else the instance default an administrator set, else the
 * built-in Overview.
 */
import { isBuiltinDashboardKey } from '#shared/analytics/dashboards';

definePageMeta({
  middleware: [
    (to) => {
      to.meta.layout = to.query.tv === '1' ? 'tv' : 'default';
    },
  ],
});

const myDefault = useCookie<string | null>(MY_DEFAULT_DASHBOARD_COOKIE, { default: () => null });
const { data: list } = await useDashboardList();

const dashboardId = computed(() => {
  const listed = (id: string | null | undefined) =>
    !!id &&
    (isBuiltinDashboardKey(id) || /^\d+$/.test(id)) &&
    (list.value ? list.value.items.some((d) => d.id === id) : true);
  if (listed(myDefault.value)) return myDefault.value!;
  if (listed(list.value?.instanceDefault)) return list.value!.instanceDefault!;
  return 'overview';
});
</script>

<template>
  <DashboardPage :key="dashboardId" :dashboard-id="dashboardId" :list="list ?? null" />
</template>
