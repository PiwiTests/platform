<script setup lang="ts">
const route = useRoute()
const projectId = route.params.id

if (import.meta.client) {
  const query = new URLSearchParams()
  query.set('tab', 'compare')
  if (route.query.runA) query.set('runA', String(route.query.runA))
  if (route.query.runB) query.set('runB', String(route.query.runB))
  await navigateTo(`/projects/${projectId}?${query.toString()}`, { replace: true })
}
</script>

<template>
  <div />
</template>
