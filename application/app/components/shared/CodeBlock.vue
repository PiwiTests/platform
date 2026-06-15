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

const { copy } = useCopy();

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
      icon="i-lucide-copy"
      title="Copy to clipboard"
      class="absolute top-1.5 right-1.5 opacity-40 hover:opacity-100 transition-opacity"
      @click="copy(code, { toast: true })"
    />
  </div>
</template>

<style scoped>
:deep(.hljs) {
  background: transparent;
  font-size: inherit;
  line-height: inherit;
}

:deep(.hljs-keyword),
:deep(.hljs-literal),
:deep(.hljs-symbol),
:deep(.hljs-name) {
  color: #8250df;
}

:deep(.hljs-string),
:deep(.hljs-meta .hljs-string),
:deep(.hljs-regexp) {
  color: #0a3069;
}

:deep(.hljs-number),
:deep(.hljs-attr),
:deep(.hljs-built_in),
:deep(.hljs-selector-class),
:deep(.hljs-selector-attr),
:deep(.hljs-selector-pseudo) {
  color: #0550ae;
}

:deep(.hljs-comment),
:deep(.hljs-quote) {
  color: #6e7781;
  font-style: italic;
}

:deep(.hljs-title),
:deep(.hljs-section) {
  color: #8250df;
  font-weight: 600;
}

:deep(.hljs-type),
:deep(.hljs-class .hljs-title) {
  color: #0550ae;
}

:deep(.hljs-variable),
:deep(.hljs-template-variable),
:deep(.hljs-params) {
  color: #953800;
}

:deep(.hljs-bullet),
:deep(.hljs-meta) {
  color: #8250df;
}

:deep(.hljs-link) {
  color: #0550ae;
  text-decoration: underline;
}

:deep(.hljs-property) {
  color: #0550ae;
}

:deep(.hljs-punctuation) {
  color: #1f2328;
}

:deep(.hljs-addition) {
  background: #e6ffec;
  color: #116329;
  display: block;
}

:deep(.hljs-deletion) {
  background: #ffebe9;
  color: #82071e;
  display: block;
}

@media (prefers-color-scheme: dark) {
  :deep(.hljs-keyword),
  :deep(.hljs-literal),
  :deep(.hljs-symbol),
  :deep(.hljs-name) {
    color: #d2a8ff;
  }

  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string),
  :deep(.hljs-regexp) {
    color: #a5d6ff;
  }

  :deep(.hljs-number),
  :deep(.hljs-attr),
  :deep(.hljs-built_in),
  :deep(.hljs-selector-class),
  :deep(.hljs-selector-attr),
  :deep(.hljs-selector-pseudo) {
    color: #79c0ff;
  }

  :deep(.hljs-comment),
  :deep(.hljs-quote) {
    color: #8b949e;
  }

  :deep(.hljs-title),
  :deep(.hljs-section) {
    color: #d2a8ff;
  }

  :deep(.hljs-type),
  :deep(.hljs-class .hljs-title) {
    color: #79c0ff;
  }

  :deep(.hljs-variable),
  :deep(.hljs-template-variable),
  :deep(.hljs-params) {
    color: #db6d28;
  }

  :deep(.hljs-bullet),
  :deep(.hljs-meta) {
    color: #d2a8ff;
  }

  :deep(.hljs-link) {
    color: #79c0ff;
  }

  :deep(.hljs-property) {
    color: #79c0ff;
  }

  :deep(.hljs-punctuation) {
    color: #e6edf3;
  }

  :deep(.hljs-addition) {
    background: #122620;
    color: #7ee787;
    display: block;
  }

  :deep(.hljs-deletion) {
    background: #25171c;
    color: #ff7b72;
    display: block;
  }
}
</style>
