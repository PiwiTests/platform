<script setup lang="ts">
/**
 * The duration of a step or a request on the execution timeline: the number,
 * its share of the test and a bar placed on the test's clock. It takes the one
 * warning tone (`app/utils/duration-tone.ts`) only when it stands out in the
 * test (`durationStandout`), and then says why on hover; otherwise it stays
 * neutral, the bar of a failed step or request in the failed outcome color.
 */
import { durationStandout, shareOfTestLabel, standoutReasonText } from '#shared/duration-standout';

const props = defineProps<{
  /** The duration, in ms. */
  ms: number;
  /** The test's duration, in ms — the share and the rule read against it. */
  testMs: number | null;
  /** Where the bar sits on its track, in percent; no bar when null. */
  bar: { left: number; width: number } | null;
  /** A group (a `test.step`, a setup section) holds other rows' time: it never stands out. */
  group?: boolean;
  /** The step or request failed: its bar keeps the failed outcome color unless the duration stands out. */
  failed?: boolean;
}>();

const standout = computed(() => (props.group ? null : durationStandout({ ms: props.ms, testMs: props.testMs })));
const share = computed(() => shareOfTestLabel(props.ms, props.testMs));
const title = computed(() =>
  standout.value ? `${formatDuration(props.ms)}, ${standoutReasonText(standout.value)}` : undefined,
);
const barClass = computed(() =>
  standout.value ? STANDOUT_BAR_CLASS : props.failed ? STATUS_PALETTE.failed.bg : DURATION_BAR_CLASS,
);
</script>

<template>
  <div :data-standout="standout?.reason" :title="title">
    <div class="flex items-center justify-between gap-2">
      <DurationValue
        :ms="ms"
        :class="['text-sm', standout ? STANDOUT_TEXT_CLASS : DURATION_TEXT_CLASS]"
        unit-class="opacity-60"
        :no-title="Boolean(standout)"
      />
      <span v-if="share" class="text-xs tabular-nums text-muted">{{ share }}</span>
    </div>
    <div v-if="bar" class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <div
        class="absolute inset-y-0 rounded-full"
        :class="barClass"
        :style="{ left: `${bar.left}%`, width: `${bar.width}%` }"
      />
    </div>
  </div>
</template>
