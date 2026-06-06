<script setup lang="ts">
import type { ReportInfo } from '~~/types/api'
import { formatBytes, getFileApiPath } from '~/utils'

defineProps<{
  reports?: ReportInfo[] | null
}>()

function reportIcon(type: string): string {
  switch (type) {
    case 'html': return 'i-lucide-layout-dashboard'
    case 'monocart': return 'i-lucide-bar-chart-2'
    case 'blob': return 'i-lucide-download'
    default: return 'i-lucide-file-text'
  }
}
</script>

<template>
  <div v-if="reports?.length" class="flex flex-wrap gap-1">
    <UButton
      v-for="report in reports"
      :key="`${report.type}-${report.path}`"
      :to="report.type !== 'blob' ? `/api/files/${getFileApiPath(report.path)}` : undefined"
      :href="report.type === 'blob' ? `/api/files/${getFileApiPath(report.path)}` : undefined"
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
