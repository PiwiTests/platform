<script setup lang="ts">
import type { ReportInfo } from '~~/types/api';
import { formatBytes, fileApiUrl } from '~/utils';

defineProps<{
  reports?: ReportInfo[] | null;
}>();

const config = useRuntimeConfig();
const { onOpenReport } = useDesktopReportLink();
</script>

<template>
  <div v-if="reports?.length" class="flex flex-wrap gap-1">
    <UButton
      v-for="report in reports"
      :key="`${report.type}-${report.path}`"
      :href="fileApiUrl(report.path, null, config.app?.baseURL)"
      :icon="reportIcon(report.type)"
      :title="report.size ? formatBytes(report.size) : report.label"
      target="_blank"
      size="xs"
      variant="outline"
      @click="onOpenReport($event, report)"
    >
      {{ report.label }}
    </UButton>
  </div>
</template>
