<script setup lang="ts">
import { useFoldableSummary } from '~/composables/useFoldableSummary'

const props = defineProps<{
  storageKey: string
}>()

const { folded, toggle } = useFoldableSummary(props.storageKey)
</script>

<template>
  <div>
    <div
      v-if="folded"
      class="border border-gray-200 dark:border-gray-800 rounded-xl p-2.5 shadow-xs cursor-pointer select-none"
      @click="toggle"
    >
      <div class="flex items-center gap-3">
        <slot name="folded" />
        <div class="ml-auto shrink-0">
          <UIcon name="i-lucide-chevron-down" class="size-4 text-gray-400" />
        </div>
      </div>
    </div>
    <div v-else class="relative">
      <div class="absolute top-1 right-1 z-10">
        <UButton
          icon="i-lucide-chevron-up"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="toggle"
          title="Collapse summary"
        />
      </div>
      <slot />
    </div>
  </div>
</template>
