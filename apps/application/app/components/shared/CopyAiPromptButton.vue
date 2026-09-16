<script setup lang="ts">
/**
 * Copies the exact request a diagnosis would send — system prompt, user message,
 * image count and response schema — so it can be pasted into another assistant
 * or read to check what Piwi actually transmits.
 *
 * It works whether or not an AI provider is configured: the payload is built
 * from stored data, not from a model call.
 */
const props = defineProps<{
  /** API path of the context endpoint, e.g. `/api/failure-clusters/12/context`. */
  contextEndpoint: string;
}>();

const { copyPrompt: copyPromptFor, copied, loading } = useCopyAiPrompt();

function copyPrompt() {
  return copyPromptFor(props.contextEndpoint);
}
</script>

<template>
  <UButton
    :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard-copy'"
    size="xs"
    color="neutral"
    variant="outline"
    :loading="loading"
    title="Copy the exact request Piwi would send to the model — to reuse it elsewhere, or to check what it contains"
    @click="copyPrompt"
  >
    {{ copied ? 'Copied' : 'Copy prompt' }}
  </UButton>
</template>
