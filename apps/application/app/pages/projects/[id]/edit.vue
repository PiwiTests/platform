<script setup lang="ts">
// The edit form folded into the project's Settings tab.
const route = useRoute();
await navigateTo(`/projects/${route.params.id}?tab=settings`, { replace: true });
</script>

<template>
  <div />
</template>
