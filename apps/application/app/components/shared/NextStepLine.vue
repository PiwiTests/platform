<script setup lang="ts">
/**
 * "Next" — the one step the page recommends, from `computeNextStep`: the title in
 * bold, the reason in muted text, the primary action as a button, one secondary
 * action inline (the rest in a small overflow menu, so the first screen keeps
 * its control budget), and — for the steps where a code change is the work — a
 * trailing "then [Copy retry command]". Each action button emits its id and
 * payload; the page turns that into the real behaviour, so this component stays
 * presentation-only and reusable across the execution and cluster pages.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import type { NextStep, NextStepKind } from '#shared/next-step';

const props = defineProps<{
  nextStep: NextStep;
  /** The retry command, shown as the trailing "then" on code-change steps. */
  retryCommand?: string | null;
}>();

const emit = defineEmits<{ action: [action: string, payload?: Record<string, unknown>] }>();

// The retry command trails only the steps whose work is a code change.
const RETRY_KINDS: NextStepKind[] = ['replace-locator', 'apply-patch', 'follow-diagnosis'];
const showRetry = computed(() => Boolean(props.retryCommand) && RETRY_KINDS.includes(props.nextStep.kind));

// One secondary inline; the rest fold into a small overflow menu.
const inlineSecondary = computed(() => props.nextStep.secondary[0] ?? null);
const overflowSecondary = computed<DropdownMenuItem[]>(() =>
  props.nextStep.secondary.slice(1).map((a) => ({
    label: a.label,
    onSelect: () => emit('action', a.action, a.payload),
  })),
);

const { copy: copyRetryCmd, copied: retryCopied } = useCopy();
</script>

<template>
  <div data-shot="next-step" class="text-sm space-y-1.5">
    <p class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span class="shrink-0 inline-flex items-center gap-1 font-medium text-primary">
        <UIcon name="i-lucide-play" class="size-3.5" />Next:
      </span>
      <span class="font-semibold text-highlighted">{{ nextStep.title }}</span>
    </p>
    <p v-if="nextStep.why" class="text-xs text-muted">{{ nextStep.why }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="xs"
        color="primary"
        variant="solid"
        @click="emit('action', nextStep.primary.action, nextStep.primary.payload)"
      >
        {{ nextStep.primary.label }}
      </UButton>
      <UButton
        v-if="inlineSecondary"
        size="xs"
        color="neutral"
        variant="outline"
        @click="emit('action', inlineSecondary.action, inlineSecondary.payload)"
      >
        {{ inlineSecondary.label }}
      </UButton>
      <UDropdownMenu v-if="overflowSecondary.length" :items="overflowSecondary">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-ellipsis"
          aria-label="More next-step actions"
        />
      </UDropdownMenu>
      <template v-if="showRetry">
        <span class="text-xs text-muted">then</span>
        <UButton
          size="xs"
          color="warning"
          variant="subtle"
          :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
          @click="copyRetryCmd(retryCommand!, { toast: 'Retry command copied' })"
        >
          Copy retry command
        </UButton>
      </template>
    </div>
  </div>
</template>
