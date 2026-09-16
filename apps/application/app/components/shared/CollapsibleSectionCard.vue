<script setup lang="ts">
/**
 * A SectionCard that can fold to a single header row. When folded, the body is
 * hidden and the header shows a one-line `#folded` peek so the section still
 * conveys its key information at a glance. Fold state is persisted per user in a
 * cookie keyed by `storageKey`, defaulting to folded.
 *
 * Same header contract as SectionCard (icon / iconClass / title / count / help /
 * subtitle / actions slot) so the two are interchangeable.
 */
import type { HelpTopicKey } from '~/utils/help-content';
import { useFoldedState } from '~/composables/useFoldedState';

const props = withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    subtitle?: string;
    count?: number | null;
    /** Tailwind color class for the header icon. */
    iconClass?: string;
    /** Inline-help topic rendered next to the title. */
    help?: HelpTopicKey;
    /** Cookie discriminator — the fold state is stored per user under this key. */
    storageKey: string;
    /** Whether the section starts folded on first visit (no stored cookie). */
    defaultFolded?: boolean;
  }>(),
  { iconClass: 'text-primary', defaultFolded: true },
);

const { folded, toggle, setFolded } = useFoldedState(`piwi-section-fold-${props.storageKey}`, props.defaultFolded);

const rootEl = ref<HTMLElement | null>(null);

/** Unfold the section and scroll it into view (e.g. from a diagnosis citation). */
function reveal() {
  setFolded(false);
  nextTick(() => rootEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

defineExpose({ setFolded, reveal });
</script>

<template>
  <div ref="rootEl" class="scroll-mt-4">
    <UCard :ui="{ header: 'p-2.5 sm:px-4 sm:py-3', body: folded ? 'p-0 sm:p-0' : '' }" :class="folded && 'divide-y-0'">
      <template #header>
        <!-- Below `sm` the actions drop to their own full-width row under the
             title so a wide actions group never squeezes the heading on a phone. -->
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <!-- role=button (not <button>) so the nested HelpHint button stays valid HTML -->
          <div
            class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-primary"
            role="button"
            tabindex="0"
            :aria-expanded="!folded"
            :title="folded ? 'Expand section' : 'Collapse section'"
            @click="toggle"
            @keydown.enter="toggle"
            @keydown.space.prevent="toggle"
          >
            <UIcon
              :name="folded ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
              class="size-4 shrink-0 text-gray-400"
            />
            <UIcon v-if="icon" :name="icon" class="size-5 shrink-0" :class="iconClass" />
            <h3 class="text-lg font-medium inline-flex items-center gap-1 shrink-0">
              {{ title }}<template v-if="count != null"> ({{ count }})</template>
            </h3>
            <span v-if="help" @click.stop><HelpHint :topic="help" /></span>
            <span
              v-if="folded && $slots.folded"
              class="min-w-0 flex-1 truncate text-sm text-gray-500 dark:text-gray-400"
            >
              <slot name="folded" />
            </span>
          </div>
          <div v-if="$slots.actions" class="flex items-center gap-1 sm:shrink-0">
            <slot name="actions" />
          </div>
        </div>
        <p v-if="!folded && (subtitle || $slots.subtitle)" class="text-sm text-gray-500 mt-1 ml-11">
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </template>

      <div v-show="!folded">
        <slot />
      </div>
    </UCard>
  </div>
</template>
