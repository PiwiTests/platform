<script setup lang="ts">
import type { TraceInfo } from '~~/types/api'

defineProps<{
  traces: TraceInfo[]
}>()

const origin = useRequestURL().origin

function downloadUrl(path: string): string {
  return `/api/files/${getFileApiPath(path)}`
}

// Opens the trace in the hosted Playwright trace viewer. The viewer fetches
// the ZIP from this dashboard in the user's browser (the files endpoint sends
// CORS headers for trace archives), so this works for localhost and
// HTTPS-hosted dashboards alike.
function viewerUrl(path: string): string {
  return `https://trace.playwright.dev/?trace=${encodeURIComponent(`${origin}/api/files/${getFileApiPath(path)}`)}`
}
</script>

<template>
  <UCard v-if="traces.length > 0">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-bug-play" class="w-5 h-5 text-primary" />
        <h3 class="text-lg font-medium">
          Traces ({{ traces.length }})
        </h3>
      </div>
    </template>

    <div class="space-y-2">
      <div
        v-for="trace in traces"
        :key="trace.id"
        class="flex items-center justify-between py-2 px-3 rounded-lg border"
      >
        <div class="flex items-center gap-2 min-w-0">
          <UIcon name="i-lucide-file-archive" class="size-4 text-gray-400 shrink-0" />
          <span class="text-sm truncate">{{ trace.filePath.split('/').pop() || trace.filePath }}</span>
          <span class="text-xs text-gray-400">{{ formatRelativeTime(trace.createdAt) }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UButton
            :to="viewerUrl(trace.filePath)"
            target="_blank"
            icon="i-lucide-bug-play"
            size="sm"
            label="View trace"
          />
          <UButton
            :to="downloadUrl(trace.filePath)"
            target="_blank"
            icon="i-lucide-download"
            size="sm"
            color="neutral"
            variant="soft"
            label="Download"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
