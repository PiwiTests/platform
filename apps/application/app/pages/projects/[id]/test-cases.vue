<script setup lang="ts">
// Redirects to the project's Tests tab, carrying the query (search, status,
// tags, owner, age, sort, page) through unchanged.
const route = useRoute();
await navigateTo({ path: `/projects/${route.params.id}`, query: { ...route.query, tab: 'tests' } }, { replace: true });
</script>

<template>
  <div />
</template>
