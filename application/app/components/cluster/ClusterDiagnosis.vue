<script setup lang="ts">
defineProps<{ clusterId?: number }>();
</script>

<template>
  <DiagnosisPanel :cluster-id="clusterId" />
</template>
