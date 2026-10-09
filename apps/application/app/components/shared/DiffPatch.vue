<script setup lang="ts">
/**
 * A unified diff, one colored row per line with its code highlighted for the
 * file's language, scrolling sideways inside itself. The root carries
 * `data-diff`, which `app:measure` counts as one text style.
 */
import { highlightDiffRows, languageForPath } from '#shared/highlight';

const props = defineProps<{
  patch: string;
  /** The patched file's path; its extension picks the language the code is highlighted in. */
  file?: string | null;
}>();

const rows = computed(() => {
  const lines = parsePatchLines(props.patch);
  const html = highlightDiffRows(lines, languageForPath(props.file));
  return lines.map((line, i) => ({ ...line, html: html[i] ?? null }));
});
</script>

<template>
  <div data-diff class="overflow-x-auto text-xs font-mono">
    <div
      v-for="(line, i) in rows"
      :key="i"
      class="px-3 py-px whitespace-pre leading-5 min-w-0"
      :class="patchLineClass[line.type]"
    >
      <template v-if="line.html === null">{{ line.text || ' ' }}</template>
      <template v-else
        >{{ line.text.charAt(0) || ' ' }}<span class="text-gray-800 dark:text-gray-200" v-html="line.html"
      /></template>
    </div>
  </div>
</template>
