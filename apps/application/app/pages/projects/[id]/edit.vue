<script setup lang="ts">
// Redirects to the project's Settings tab, which holds the edit form.
const route = useRoute();
await navigateTo(
  { path: `/projects/${route.params.id}`, query: { tab: 'settings' }, hash: route.hash },
  { replace: true },
);
</script>

<template>
  <div />
</template>
