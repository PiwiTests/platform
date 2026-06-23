<script setup lang="ts">
/**
 * Discreet inline-help affordance: a small muted help icon that opens a popover
 * with a short explanation and an optional "Learn more" docs link. Resolve copy
 * from the shared registry via `topic`, or pass `title`/`text`/`doc` inline for
 * one-offs.
 *
 * Click-mode popover (not a hover tooltip) so the content can hold a real link
 * and stay keyboard- and touch-accessible. Use `i-lucide-circle-help` here and
 * reserve `i-lucide-info` for informational/empty-state callouts.
 */
import { HELP_TOPICS, type HelpTopic, type HelpTopicKey } from '~/utils/help-content';

const props = defineProps<{
  /** Resolve copy from the registry… */
  topic?: HelpTopicKey;
  /** …or pass inline for rare one-offs. */
  title?: string;
  text?: string;
  doc?: string;
  /** Trigger icon size. Default 'xs'. */
  size?: 'xs' | 'sm';
}>();

const entry = computed<HelpTopic | null>(() => (props.topic ? HELP_TOPICS[props.topic] : null));
const title = computed(() => props.title ?? entry.value?.title);
const text = computed(() => props.text ?? entry.value?.text ?? '');
const doc = computed(() => props.doc ?? entry.value?.doc);

const open = ref(false);
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'max-w-xs p-3 text-sm' }">
    <UButton
      :size="size ?? 'xs'"
      variant="ghost"
      color="neutral"
      icon="i-lucide-circle-help"
      :aria-label="title ? `Help: ${title}` : 'Help'"
      title="What is this?"
      class="text-muted hover:text-default align-middle"
    />

    <template #content>
      <p v-if="title" class="font-medium mb-1">{{ title }}</p>
      <p class="text-muted">{{ text }}</p>
      <div v-if="doc" class="mt-2">
        <DocLink :to="doc">Learn more</DocLink>
      </div>
    </template>
  </UPopover>
</template>
