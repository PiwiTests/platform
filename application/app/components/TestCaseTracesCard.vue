<script setup lang="ts">
import type { TraceInfo } from '~~/types/api'

defineProps<{
  traces: TraceInfo[]
}>()
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
        <UButton
          :to="getFileApiPath(trace.filePath)"
          target="_blank"
          icon="i-lucide-external-link"
          size="sm"
          color="neutral"
          variant="soft"
          label="Open trace"
        />
      </div>
    </div>
  </UCard>
</template>
