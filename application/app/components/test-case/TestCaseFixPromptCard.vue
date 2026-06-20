<script setup lang="ts">
const props = defineProps<{
  prompt: string;
}>();

const { copy, copied } = useCopy();
</script>

<template>
  <SectionCard icon="i-lucide-sparkles" icon-class="text-amber-500" title="Debug prompt for AI">
    <template #actions>
      <UButton
        :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
        size="xs"
        color="neutral"
        variant="ghost"
        :label="copied ? 'Copied!' : 'Copy'"
        :title="copied ? 'Copied!' : copyPreview(prompt)"
        @click="copy(prompt)"
      />
    </template>

    <p class="text-sm text-gray-500 mb-3">
      Paste this prompt into ChatGPT, Claude, or any AI assistant to get help fixing this test failure. It includes all
      relevant context: error message, test steps, network issues, and page ARIA snapshot.
    </p>
    <pre
      class="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto"
      >{{ prompt }}</pre
    >
  </SectionCard>
</template>
