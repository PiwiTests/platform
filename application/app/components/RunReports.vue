<script setup lang="ts">
import type { ReportInfo } from '~~/types/api'
import { formatBytes, getFileApiPath } from '~/utils'

const props = defineProps<{
  reports?: ReportInfo[] | null
  legacyPath?: string | null
  legacySize?: number | null
}>()

const normalizedReports = computed<ReportInfo[]>(() => {
  if (props.reports && props.reports.length > 0) return props.reports
  if (props.legacyPath) {
    return [{
      id: 0,
      type: 'html',
      label: 'HTML Report',
      path: props.legacyPath,
      size: props.legacySize
    }]
  }
  return []
})

function reportIcon(type: string): string {
  switch (type) {
    case 'html': return 'i-lucide-layout-dashboard'
    case 'monocart': return 'i-lucide-bar-chart-2'
    case 'allure': return 'i-lucide-flask-conical'
    case 'blob': return 'i-lucide-download'
    default: return 'i-lucide-file-text'
  }
}
</script>

<template>
  <div v-if="normalizedReports.length" class="flex flex-wrap gap-1">
    <UButton
      v-for="report in normalizedReports"
      :key="`${report.type}-${report.path}`"
      :to="report.type !== 'blob' ? `/api/files/${getFileApiPath(report.path)}` : undefined"
      :href="report.type === 'blob' ? `/api/files/${getFileApiPath(report.path)}` : undefined"
      :download="report.type === 'blob' ? true : undefined"
      :target="report.type !== 'blob' ? '_blank' : undefined"
      :icon="reportIcon(report.type)"
      :title="report.size ? formatBytes(report.size) : report.label"
      size="xs"
      variant="outline"
    >
      {{ report.label }}
    </UButton>
  </div>
</template>
