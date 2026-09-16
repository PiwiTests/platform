<script setup lang="ts">
// The test catalog folded into the project's Tests tab; the old query (search,
// status, tags, owner, age, sort, page) is carried through unchanged.
const route = useRoute();
await navigateTo({ path: `/projects/${route.params.id}`, query: { ...route.query, tab: 'tests' } }, { replace: true });
</script>

<template>
  <div />
</template>
