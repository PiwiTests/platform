<script setup lang="ts">
import type { ReportInfo } from '~~/types/api';
import { formatBytes, getFileApiPath } from '~/utils';

defineProps<{
  reports?: ReportInfo[] | null;
}>();
</script>

<template>
  <div v-if="reports?.length" class="flex flex-wrap gap-1">
    <UButton
      v-for="report in reports"
      :key="`${report.type}-${report.path}`"
      :href="`/api/files/${getFileApiPath(report.path)}`"
      :icon="reportIcon(report.type)"
      :title="report.size ? formatBytes(report.size) : report.label"
      target="_blank"
      size="xs"
      variant="outline"
    >
      {{ report.label }}
    </UButton>
  </div>
</template>
