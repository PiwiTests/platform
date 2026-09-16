<script setup lang="ts">
/**
 * The one block at the top of a failure page: what broke, what is going on and
 * what to do next. An identity kicker and the page's `<h1>` on top, then a
 * labelled list — "Most likely", "Situation", "Occurrences", "What changed",
 * "State", "Next" — whose labels sit in one narrow column so the lines read as a
 * structured record rather than a paragraph, then the facts line under a divider.
 * Every line is an optional named slot; a line with no slot collapses, so the same
 * frame serves a failing execution, a passing one (identity and facts only) and
 * the cluster page, which adds its occurrence, what-changed and state lines.
 *
 * The block uses four text styles and no more: the heading, one body style for
 * the sentences, one label style, one meta style. It carries the page's single
 * help hint; nothing else on it does.
 */
import type { HelpTopicKey } from '~/utils/help-content';

defineProps<{ help?: HelpTopicKey }>();

const ROWS = [
  { slot: 'story', label: 'Most likely' },
  { slot: 'situation', label: 'Situation' },
  { slot: 'occurrences', label: 'Occurrences' },
  { slot: 'whatChanged', label: 'What changed' },
  { slot: 'state', label: 'State' },
  { slot: 'next', label: 'Next' },
] as const;
</script>

<template>
  <div
    data-shot="situation-block"
    class="rounded-lg border border-default bg-default p-3 sm:p-4 max-sm:rounded-none max-sm:border-x-0"
  >
    <!-- Identity kicker, with the block's one help hint and any actions -->
    <div v-if="$slots.identity || $slots.actions || help" class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1 text-sm text-muted"><slot name="identity" /></div>
      <div v-if="$slots.actions || help" class="flex items-center gap-1.5 shrink-0">
        <slot name="actions" />
        <HelpHint v-if="help" :topic="help" />
      </div>
    </div>

    <!-- The headline — the page's h1 -->
    <div v-if="$slots.headline" class="mt-1.5"><slot name="headline" /></div>

    <!-- The labelled lines: one narrow label column, one content column -->
    <dl
      v-if="ROWS.some((r) => $slots[r.slot])"
      class="mt-4 grid grid-cols-1 gap-y-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-x-4"
    >
      <template v-for="row in ROWS" :key="row.slot">
        <template v-if="$slots[row.slot]">
          <dt class="text-xs font-medium text-muted sm:pt-0.5 max-sm:-mb-2">{{ row.label }}</dt>
          <dd class="min-w-0 text-sm text-highlighted leading-relaxed"><slot :name="row.slot" /></dd>
        </template>
      </template>
    </dl>

    <!-- The facts line, one size smaller, under a divider -->
    <div v-if="$slots.facts" class="mt-4 border-t border-default pt-2.5 text-xs text-muted">
      <slot name="facts" />
    </div>
  </div>
</template>
