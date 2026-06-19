<script setup lang="ts">
import type { TraceInfo } from '~~/types/api';

defineProps<{
  traces: TraceInfo[];
  loading?: boolean;
}>();

const origin = computed(() => {
  if (import.meta.client) return window.location.origin;
  return useRequestURL().origin;
});

function downloadUrl(path: string): string {
  return `/api/files/${getFileApiPath(path)}`;
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}
</script>

<template>
  <TestEvidenceSection
    v-if="loading || traces.length > 0"
    icon="i-lucide-bug-play"
    label="Traces"
    :count="traces.length || null"
    :collapsible="false"
  >
    <template #default>
      <div v-if="loading && !traces.length" class="flex items-center justify-center py-4">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
      </div>
      <div v-else class="divide-y divide-default">
        <div v-for="trace in traces" :key="trace.id" class="flex items-center justify-between px-3 py-2 gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <UIcon name="i-lucide-file-archive" class="size-3.5 text-gray-400 shrink-0" />
            <span class="text-xs truncate">{{ fileName(trace.filePath) }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ formatRelativeTime(trace.createdAt) }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <UButton
              :to="getTraceViewerUrl(trace.filePath, origin)"
              target="_blank"
              icon="i-lucide-play"
              size="xs"
              label="View"
            />
            <UButton
              :to="downloadUrl(trace.filePath)"
              target="_blank"
              icon="i-lucide-download"
              size="xs"
              color="neutral"
              variant="soft"
            />
          </div>
        </div>
      </div>
    </template>
  </TestEvidenceSection>
</template>
