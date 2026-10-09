<script setup lang="ts">
/**
 * "Next" — the one step the page recommends, from `computeNextStep`: the step as
 * a sentence, then one meta line, which says where the step's change comes from
 * (the diagnosis or locator healing) when the page passes that sentence and gives
 * the step's reason otherwise, then one row of actions — the primary
 * action as the block's only solid button, one secondary action inline, and the
 * rest in a small overflow menu, so the first screen keeps its control budget;
 * for the steps where a code change is the work, that menu also copies the retry
 * command to run afterwards. Each action button emits its id and payload; the
 * page turns that into the real behaviour, so this component stays
 * presentation-only and reusable across the execution and cluster pages. The
 * block that renders this line provides its label.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import type { NextStep, NextStepKind } from '#shared/next-step';

const props = defineProps<{
  nextStep: NextStep;
  /** The retry command, offered after the code-change steps. */
  retryCommand?: string | null;
  /** Where the step's change comes from (`nextStepSourceLine`); shown in place of the reason. */
  source?: string | null;
}>();

const emit = defineEmits<{ action: [action: string, payload?: Record<string, unknown>] }>();

// The retry command trails only the steps whose work is a code change.
const RETRY_KINDS: NextStepKind[] = ['replace-locator', 'apply-patch', 'follow-diagnosis'];
const showRetry = computed(() => Boolean(props.retryCommand) && RETRY_KINDS.includes(props.nextStep.kind));

const { copy: copyRetryCmd } = useCopy();

// One secondary inline; the rest fold into a small overflow menu, the retry
// command last.
const inlineSecondary = computed(() => props.nextStep.secondary[0] ?? null);
const overflowSecondary = computed<DropdownMenuItem[]>(() => [
  ...props.nextStep.secondary.slice(1).map((a) => ({
    label: a.label,
    onSelect: () => emit('action', a.action, a.payload),
  })),
  ...(showRetry.value
    ? [
        {
          label: 'Copy retry command',
          onSelect: () => void copyRetryCmd(props.retryCommand!, { toast: 'Retry command copied' }),
        },
      ]
    : []),
]);
</script>

<template>
  <div data-shot="next-step" :data-next-kind="nextStep.kind" class="space-y-1">
    <p>{{ nextStep.title }}</p>
    <p v-if="source" data-shot="next-step-source" class="text-xs text-muted">{{ source }}</p>
    <p v-else-if="nextStep.why" class="text-xs text-muted">{{ nextStep.why }}</p>
    <div class="flex flex-wrap items-center gap-2 pt-1">
      <UButton
        size="xs"
        color="primary"
        variant="solid"
        :data-next-action="nextStep.primary.action"
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
    </div>
  </div>
</template>
