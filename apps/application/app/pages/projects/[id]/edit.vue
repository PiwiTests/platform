<script setup lang="ts">
// The edit form folded into the project's Settings tab.
const route = useRoute();
await navigateTo(
  { path: `/projects/${route.params.id}`, query: { tab: 'settings' }, hash: route.hash },
  { replace: true },
);
</script>

<template>
  <div />
</template>
