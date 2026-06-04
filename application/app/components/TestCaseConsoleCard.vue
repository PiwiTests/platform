<script setup lang="ts">
defineProps<{
  entries: Array<{
    type: string
    text: string
    timestamp?: number
    location?: string | null
  }>
}>()

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const expanded = ref(false)

function consoleTypeColor(type: string): 'error' | 'warning' | 'neutral' {
  switch (type) {
    case 'error': return 'error'
    case 'warning': return 'warning'
    case 'assert': return 'error'
    default: return 'neutral'
  }
}

function consoleTypeIcon(type: string): string {
  switch (type) {
    case 'error': return 'i-lucide-octagon-x'
    case 'warning': return 'i-lucide-alert-triangle'
    case 'assert': return 'i-lucide-octagon-x'
    default: return 'i-lucide-message-square'
  }
}
</script>

<template>
  <UCard v-if="entries.length > 0">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-terminal" class="w-5 h-5 text-primary" />
        <h3 class="text-lg font-medium">
          Console output ({{ entries.length }})
        </h3>
      </div>
    </template>

    <div class="space-y-1 max-h-80 overflow-y-auto">
      <div
        v-for="(entry, index) in entries"
        :key="index"
        class="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
      >
        <UIcon
          :name="consoleTypeIcon(entry.type)"
          :class="entry.type === 'error' || entry.type === 'assert' ? 'text-red-500' : entry.type === 'warning' ? 'text-amber-500' : 'text-gray-400'"
          class="size-4 mt-0.5 shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <UBadge
              :color="consoleTypeColor(entry.type)"
              variant="soft"
              size="xs"
              class="shrink-0"
            >
              {{ entry.type }}
            </UBadge>
            <span class="truncate">{{ entry.text }}</span>
          </div>
          <div v-if="entry.location" class="text-xs text-gray-400 mt-0.5 ml-0">
            {{ entry.location }}
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
