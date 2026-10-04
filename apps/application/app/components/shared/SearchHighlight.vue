<script setup lang="ts">
/**
 * A piece of text with the parts a search matched marked, as the browser's own
 * find would. `patterns` are search values (`*` as a wildcard, case ignored),
 * from `testSearchHighlights`; with none it renders the plain text.
 */
import { highlightRanges } from '#shared/test-search';

const props = defineProps<{
  text: string;
  patterns?: readonly string[] | null;
}>();

const segments = computed(() => {
  const ranges = highlightRanges(props.text, props.patterns);
  if (ranges.length === 0) return [{ text: props.text, marked: false }];
  const out: Array<{ text: string; marked: boolean }> = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: props.text.slice(at, start), marked: false });
    out.push({ text: props.text.slice(start, end), marked: true });
    at = end;
  }
  if (at < props.text.length) out.push({ text: props.text.slice(at), marked: false });
  return out;
});
</script>

<template>
  <template v-for="(segment, i) in segments" :key="i">
    <mark v-if="segment.marked" class="rounded-[2px] bg-yellow-200 text-current dark:bg-yellow-400/30">{{
      segment.text
    }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>
