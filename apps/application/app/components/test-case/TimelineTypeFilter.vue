<script setup lang="ts">
/**
 * The failure timeline's type filter, which doubles as the axis legend for the
 * types: one toggle chip per item type in the current window, carrying the
 * type's icon in its axis hue, its label and its count. A click hides or shows
 * a type — the last shown one stays; *Only ▾* (or Alt-click on a chip) shows
 * just one type. A hidden chip is struck through behind an eye-off icon, and a
 * line beside the chips says what the filter leaves out — naming any failed
 * request, error or warning among it — with *Show all* back to everything.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import type { TimelineItem, TimelineLane } from '#shared/failure-timeline';
import {
  TIMELINE_TYPE_META,
  countTimelineTypes,
  hiddenSummaryRuns,
  summarizeHiddenItems,
} from '~/utils/timeline-type-filter';

const props = defineProps<{
  /** The types with items in the current window — one chip each, in lane order. */
  types: readonly TimelineLane[];
  /** The items in the current window before filtering — the chip counts and the hidden line read them. */
  items: readonly TimelineItem[];
  /** The types currently hidden, among `types`. */
  hidden: readonly TimelineLane[];
}>();

const emit = defineEmits<{ toggle: [type: TimelineLane]; only: [type: TimelineLane]; showAll: [] }>();

const hiddenSet = computed(() => new Set(props.hidden));
const counts = computed(() => countTimelineTypes(props.items));
const hiddenRuns = computed(() => hiddenSummaryRuns(summarizeHiddenItems(props.items, hiddenSet.value)));
const SEVERITY_TEXT = { error: 'text-error', warning: 'text-warning' } as const;

/** The one type still shown — a click cannot hide it. */
function isLastShown(type: TimelineLane): boolean {
  return !hiddenSet.value.has(type) && props.types.length - props.hidden.length === 1;
}

function chipTitle(type: TimelineLane): string {
  const noun = TIMELINE_TYPE_META[type].many;
  if (hiddenSet.value.has(type)) return `Show ${noun}`;
  if (isLastShown(type)) return 'The last shown type stays shown';
  const keeps = type === 'steps' ? ' (the failing step stays)' : '';
  return `Hide ${noun}${keeps} · Alt-click to show only ${noun}`;
}

function onChipClick(event: MouseEvent, type: TimelineLane): void {
  if (event.altKey) emit('only', type);
  else if (!isLastShown(type)) emit('toggle', type);
}

const onlyItems = computed<DropdownMenuItem[]>(() =>
  props.types.map((type) => ({
    label: `Only ${TIMELINE_TYPE_META[type].many}`,
    icon: TIMELINE_TYPE_META[type].icon,
    onSelect: () => emit('only', type),
  })),
);

// *Show all* removes the line it sits in; focus moves to the first chip.
const group = ref<HTMLElement | null>(null);
function onShowAll(): void {
  emit('showAll');
  nextTick(() => group.value?.querySelector('button')?.focus());
}
</script>

<template>
  <div data-shot="timeline-type-filter" class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    <div ref="group" role="group" aria-label="Show on the timeline" class="flex flex-wrap items-center gap-1">
      <span class="mr-1 text-xs font-medium text-muted" aria-hidden="true">Show</span>
      <button
        v-for="type in types"
        :key="type"
        type="button"
        :aria-pressed="hiddenSet.has(type) ? 'false' : 'true'"
        :aria-disabled="isLastShown(type) ? 'true' : undefined"
        :title="chipTitle(type)"
        class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium select-none outline-none transition-colors focus-visible:outline-2 focus-visible:outline-primary"
        :class="
          hiddenSet.has(type)
            ? 'border-dashed border-accented text-muted hover:bg-elevated/60'
            : isLastShown(type)
              ? 'border-default bg-default text-default cursor-default'
              : 'border-default bg-default text-default hover:bg-elevated/60'
        "
        @click="onChipClick($event, type)"
      >
        <UIcon
          :name="hiddenSet.has(type) ? 'i-lucide-eye-off' : TIMELINE_TYPE_META[type].icon"
          class="size-3.5 shrink-0"
          :class="hiddenSet.has(type) ? '' : TIMELINE_TYPE_META[type].iconClass"
        />
        <span :class="hiddenSet.has(type) ? 'line-through' : ''">{{ TIMELINE_TYPE_META[type].label }}</span>
        <span class="tabular-nums" :class="hiddenSet.has(type) ? '' : 'text-muted'">{{ counts[type] }}</span>
      </button>
      <UDropdownMenu :items="onlyItems" :content="{ align: 'start' }">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          label="Only"
          trailing-icon="i-lucide-chevron-down"
          aria-label="Show only one type"
          title="Show only one type"
        />
      </UDropdownMenu>
    </div>

    <!-- What the filter leaves out of this window, so a hidden type is never forgotten. -->
    <p v-if="hiddenRuns.length" data-testid="timeline-hidden-summary" class="text-xs text-muted">
      Hidden:
      <span v-for="(run, i) in hiddenRuns" :key="i" :class="run.severity && SEVERITY_TEXT[run.severity]">{{
        run.text
      }}</span
      >{{ ' ' }}<span aria-hidden="true">·</span>{{ ' '
      }}<button type="button" :class="SENTENCE_LINK_CLASS" @click="onShowAll">Show all</button>
    </p>
  </div>
</template>
