<script setup lang="ts">
// The Compare tab folded into the project's Runs tab, where selecting two runs
// opens the newer run's Changes tab.
const route = useRoute();
await navigateTo(`/projects/${route.params.id}?tab=runs`, { replace: true });
</script>

<template>
  <div />
</template>
