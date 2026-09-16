<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  date: string | Date | number | null | undefined;
  dateOnly?: boolean;
}>();

const formatted = computed(() => prettyDateFormat(props.date, { dateOnly: props.dateOnly }));
</script>

<!--
  Absolute timestamps render client-only: the server host and the visitor's
  browser rarely share a time zone, so an SSR'd prettyDateFormat string would
  differ from the hydrated one. Rendering only in the browser keeps every
  absolute date in the visitor's local time with no hydration mismatch.
-->
<template>
  <ClientOnly>
    <span v-bind="$attrs">{{ formatted }}</span>
  </ClientOnly>
</template>
