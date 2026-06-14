<script setup lang="ts">
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import diff from 'highlight.js/lib/languages/diff';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('diff', diff);

const props = defineProps<{
  text: string | null;
  loading?: boolean;
}>();

type PreviewLine =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'blank' }
  | { kind: 'code-start'; lang: string }
  | { kind: 'code-block'; html: string }
  | { kind: 'code-end' };

function parse(text: string): PreviewLine[] {
  const result: PreviewLine[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (const line of text.split('\n')) {
    if (!inCode) {
      if (line.startsWith('```')) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else if (line.startsWith('## ')) {
        result.push({ kind: 'h2', text: line.slice(3) });
      } else if (line.startsWith('### ')) {
        result.push({ kind: 'h3', text: line.slice(4) });
      } else if (line.startsWith('> ')) {
        result.push({ kind: 'note', text: line.slice(2) });
      } else if (line.startsWith('- ')) {
        result.push({ kind: 'bullet', text: line.slice(2) });
      } else if (line.trim() === '') {
        result.push({ kind: 'blank' });
      } else {
        result.push({ kind: 'text', text: line });
      }
    } else {
      if (line === '```') {
        const code = codeLines.join('\n');
        if (codeLines.length) {
          const { value } =
            codeLang && hljs.getLanguage(codeLang)
              ? hljs.highlight(code, { language: codeLang })
              : hljs.highlightAuto(code);
          result.push({ kind: 'code-start', lang: codeLang || 'code' });
          result.push({ kind: 'code-block', html: value });
          result.push({ kind: 'code-end' });
        }
        inCode = false;
      } else {
        codeLines.push(line);
      }
    }
  }

  if (inCode && codeLines.length) {
    const code = codeLines.join('\n');
    const { value } =
      codeLang && hljs.getLanguage(codeLang) ? hljs.highlight(code, { language: codeLang }) : hljs.highlightAuto(code);
    result.push({ kind: 'code-start', lang: codeLang || 'code' });
    result.push({ kind: 'code-block', html: value });
    result.push({ kind: 'code-end' });
  }

  return result;
}

const lines = computed<PreviewLine[]>(() => (props.text ? parse(props.text) : []));
</script>

<template>
  <div class="rounded-lg border border-default overflow-hidden bg-muted min-h-16">
    <div v-if="loading" class="flex items-center gap-2 p-4 text-sm text-gray-500">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Fetching context… (includes SCM diff lookup)</span>
    </div>
    <div v-else-if="lines.length" class="overflow-auto max-h-[45vh] p-3 text-xs font-mono leading-relaxed">
      <template v-for="(line, i) in lines" :key="i">
        <div v-if="line.kind === 'h2'" class="text-sm font-bold text-gray-900 dark:text-white mt-4 mb-0.5 first:mt-0">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'h3'" class="font-semibold text-gray-700 dark:text-gray-200 mt-2 mb-0.5">
          {{ line.text }}
        </div>
        <div
          v-else-if="line.kind === 'note'"
          class="my-1 px-2 py-0.5 rounded bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 italic"
        >
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'bullet'" class="text-gray-600 dark:text-gray-400 flex gap-1.5">
          <span class="text-gray-400 shrink-0">·</span>
          <span>{{ line.text }}</span>
        </div>
        <div v-else-if="line.kind === 'text'" class="text-gray-600 dark:text-gray-400">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'blank'" class="h-2" />
        <div
          v-else-if="line.kind === 'code-start'"
          class="mt-2 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-t text-[10px] uppercase tracking-wide"
        >
          {{ line.lang || 'code' }}
        </div>
        <div v-else-if="line.kind === 'code-block'" class="overflow-x-auto bg-gray-50 dark:bg-gray-900/40">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <pre class="hljs px-2 py-1 !bg-transparent whitespace-pre-wrap" v-html="line.html" />
        </div>
        <div v-else-if="line.kind === 'code-end'" class="h-1 bg-gray-100 dark:bg-gray-800/50 rounded-b mb-2" />
      </template>
    </div>
    <div v-else class="p-3 text-xs text-gray-400 italic">No context loaded</div>
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
:deep(.hljs-regexp),
:deep(.hljs-addition) {
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
:deep(.hljs-template-variable) {
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

:deep(.hljs-emphasis) {
  font-style: italic;
}

:deep(.hljs-strong) {
  font-weight: bold;
}

:deep(.hljs-deletion) {
  color: #cf222e;
}

:deep(.hljs-params) {
  color: #953800;
}

:deep(.hljs-property) {
  color: #0550ae;
}

:deep(.hljs-punctuation) {
  color: #1f2328;
}

/* diff */
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
  :deep(.hljs-regexp),
  :deep(.hljs-addition) {
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
  :deep(.hljs-template-variable) {
    color: #db6d28;
  }

  :deep(.hljs-bullet),
  :deep(.hljs-meta) {
    color: #d2a8ff;
  }

  :deep(.hljs-link) {
    color: #79c0ff;
  }

  :deep(.hljs-deletion) {
    color: #ff7b72;
  }

  :deep(.hljs-params) {
    color: #db6d28;
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
