<script setup lang="ts">
/**
 * UCard with a standard header: optional icon, title, optional `(count)` and an
 * optional subtitle/description line. Use the `actions` slot for header-right
 * controls (badge, button) and the default slot for the body. `subtitle` slot
 * overrides the `subtitle` prop when richer markup is needed.
 *
 * Pass `help` (a registry topic key) to render an inline `HelpHint` beside the
 * title — the standard way to document a non-self-explanatory block.
 *
 * With `embedded`, the card chrome is dropped: no border, radius, background or
 * padding, just a plain heading row (icon / title / count / help / actions) over
 * the body. Use it for a section nested inside another card, where a second card
 * frame would only add width-eating gutters.
 */
import type { HelpTopicKey } from '~/utils/help-content';

withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    subtitle?: string;
    count?: number | null;
    /** Tailwind color class for the header icon. */
    iconClass?: string;
    /** Inline-help topic rendered next to the title. */
    help?: HelpTopicKey;
    /** Drop the card frame and padding — render a plain heading row over the body. */
    embedded?: boolean;
  }>(),
  { iconClass: 'text-primary' },
);
</script>

<template>
  <section v-if="embedded">
    <!-- Below `sm` the actions drop to their own full-width row under the title
         and subtitle, so a wide actions group never squeezes the subtitle into a
         one-word-per-line column on a phone. An empty `title` renders no heading
         (the tab strip is the heading) while its actions row still leads the tab. -->
    <div
      v-if="title || icon || count != null || subtitle || $slots.subtitle || $slots.actions"
      class="flex flex-col gap-y-1 sm:flex-row sm:items-start sm:justify-between sm:flex-wrap sm:gap-x-2 mb-2"
    >
      <div
        v-if="title || icon || count != null || subtitle || $slots.subtitle"
        class="flex items-center gap-2 min-w-0 sm:basis-56 sm:grow"
      >
        <UIcon v-if="icon" :name="icon" class="w-5 h-5 shrink-0" :class="iconClass" />
        <div class="min-w-0">
          <h3 v-if="title || count != null" class="text-base font-medium inline-flex items-center gap-1">
            {{ title }}<template v-if="count != null"> ({{ count }})</template>
            <HelpHint v-if="help" :topic="help" />
          </h3>
          <p v-if="subtitle || $slots.subtitle" class="text-sm text-gray-500 mt-0.5">
            <slot name="subtitle">{{ subtitle }}</slot>
          </p>
        </div>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-1 sm:shrink-0">
        <slot name="actions" />
      </div>
    </div>

    <slot />

    <div v-if="$slots.footer" class="mt-3">
      <slot name="footer" />
    </div>
  </section>

  <UCard v-else>
    <template #header>
      <!-- Below `sm` the actions drop to their own full-width row under the title
           and subtitle; from `sm` up they sit on the right and wrap under the
           title rather than squeezing it, so a wide actions group (a chart
           legend, two buttons) never crushes the heading or the subtitle. -->
      <div class="flex flex-col gap-y-1 sm:flex-row sm:items-start sm:justify-between sm:flex-wrap sm:gap-x-2">
        <div class="flex items-center gap-2 min-w-0 sm:basis-56 sm:grow">
          <UIcon v-if="icon" :name="icon" class="w-5 h-5 shrink-0" :class="iconClass" />
          <div class="min-w-0">
            <h3 class="text-lg font-medium inline-flex items-center gap-1">
              {{ title }}<template v-if="count != null"> ({{ count }})</template>
              <HelpHint v-if="help" :topic="help" />
            </h3>
            <p v-if="subtitle || $slots.subtitle" class="text-sm text-gray-500 mt-0.5">
              <slot name="subtitle">{{ subtitle }}</slot>
            </p>
          </div>
        </div>
        <div v-if="$slots.actions" class="flex items-center gap-1 sm:shrink-0">
          <slot name="actions" />
        </div>
      </div>
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
