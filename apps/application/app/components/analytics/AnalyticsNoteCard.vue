<script setup lang="ts">
import type { AnalyticsNote } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

// The server renders the Markdown with raw HTML escaped, so the note is safe to insert.
const { data, pending, error } = await useAnalyticsWidget<AnalyticsNote>(
  'text',
  () => props.query,
  () => props.options,
);
</script>

<template>
  <SectionCard icon="i-lucide-text" :title="title ?? 'Note'" data-shot="analytics-note">
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the note: ${errorMessage(error)}`" />
    <EmptyState v-else-if="!data?.html" text="This note is empty." />
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div
      v-else
      class="text-sm text-highlighted leading-relaxed break-words [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_a]:decoration-dotted [&_code]:font-mono [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold"
      v-html="data.html"
    />
  </SectionCard>
</template>
