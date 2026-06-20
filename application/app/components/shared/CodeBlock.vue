<script setup lang="ts">
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('diff', diff);

const props = defineProps<{
  code: string;
  lang?: string;
}>();

const { copy, copied } = useCopy();

const detectedLang = ref('');

const highlighted = computed(() => {
  if (props.lang && hljs.getLanguage(props.lang)) {
    detectedLang.value = props.lang;
    return hljs.highlight(props.code, { language: props.lang }).value;
  }
  const result = hljs.highlightAuto(props.code);
  detectedLang.value = result.language ?? '';
  return result.value;
});
</script>

<template>
  <div class="relative">
    <pre
      class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 pt-8 pb-3 text-sm font-mono overflow-x-auto leading-relaxed"
    ><code class="hljs !bg-transparent" v-html="highlighted" /></pre>
    <!-- Language label -->
    <span
      v-if="detectedLang"
      class="absolute top-2 left-3 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 select-none pointer-events-none"
      >{{ detectedLang }}</span
    >
    <!-- Copy button -->
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
      :title="copied ? 'Copied!' : copyPreview(code)"
      class="absolute top-1.5 right-1.5 opacity-40 hover:opacity-100 transition-opacity"
      @click="copy(code, { toast: true })"
    />
  </div>
</template>
