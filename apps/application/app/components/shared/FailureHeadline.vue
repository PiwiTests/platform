<script setup lang="ts">
/**
 * The one-line failure headline, with its locator rendered as code and its
 * values emphasized. Pass `parts` from an already-built verdict, or `error`
 * (plus the steps, when known) to describe a raw error in place — the run
 * list's failing rows do the latter. With `error` set, the plain raw error is
 * the tooltip, so the verbatim text is one hover away. In `plain` mode the
 * locator inherits the heading's color instead of being syntax-highlighted.
 */
import { describeFailureText, lastStepTitle, type HeadlinePart } from '#shared/describe-failure';
import { stripAnsi } from '#shared/error-parse';

const props = withDefaults(
  defineProps<{
    parts?: HeadlinePart[] | null;
    error?: string | null;
    steps?: Array<{ title: string; failed?: boolean | null }> | null;
    /** Keeps the line to one row, ellipsized — for dense list rows. */
    truncate?: boolean;
    /** The locator inherits the surrounding color — for a headline used as a heading. */
    plain?: boolean;
  }>(),
  { parts: null, error: null, steps: null, truncate: false, plain: false },
);

const resolvedParts = computed<HeadlinePart[]>(() => {
  if (props.parts?.length) return props.parts;
  return describeFailureText(props.error, { lastStepTitle: lastStepTitle(props.steps) })?.parts ?? [];
});

const title = computed(() => (props.error ? stripAnsi(props.error).trim() : undefined));
</script>

<template>
  <span :class="truncate ? 'block truncate min-w-0' : 'break-words'" :title="title">
    <template v-for="(part, i) in resolvedParts" :key="i">
      <LocatorCode v-if="part.kind === 'locator'" :locator="part.text" :plain="plain" class="text-[0.92em]" />
      <span v-else-if="part.kind === 'value'" :class="plain ? '' : 'font-medium text-highlighted'">{{
        part.text
      }}</span>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>
