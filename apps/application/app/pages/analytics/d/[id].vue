<script setup lang="ts">
/** `/analytics/d/<id>`: one dashboard, a built-in key or a saved dashboard's id. */
definePageMeta({
  middleware: [
    (to) => {
      to.meta.layout = to.query.tv === '1' ? 'tv' : 'default';
    },
  ],
});

const route = useRoute();
const dashboardId = computed(() => String(route.params.id));
const { data: list } = await useDashboardList();
</script>

<template>
  <DashboardPage :key="dashboardId" :dashboard-id="dashboardId" :list="list ?? null" />
</template>
