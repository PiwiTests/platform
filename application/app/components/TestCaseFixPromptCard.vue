<script setup lang="ts">
const props = defineProps<{
  prompt: string
}>()

const copySuccess = ref(false)

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(props.prompt)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch {
    // Clipboard not available
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sparkles" class="w-5 h-5 text-amber-500" />
          <h3 class="text-lg font-medium">
            Debug prompt for AI
          </h3>
        </div>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Copy"
            @click="copyPrompt()"
          />
          <span v-if="copySuccess" class="text-xs text-green-600 mr-1">Copied!</span>
        </div>
      </div>
    </template>

    <p class="text-sm text-gray-500 mb-3">
      Paste this prompt into ChatGPT, Claude, or any AI assistant to get help fixing this test failure.
      It includes all relevant context: error message, test steps, and network issues.
    </p>
    <pre class="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">{{ prompt }}</pre>
  </UCard>
</template>
