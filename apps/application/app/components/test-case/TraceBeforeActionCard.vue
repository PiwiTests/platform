<script setup lang="ts">
/**
 * The failing action's page as a pair of trace screenshots — the frame *before
 * the failing action* beside the frame *at the failure* — when the trace was
 * recorded with `snapshots.screen`. Reads this run's own trace, so it needs no
 * baseline.
 */
import type { EvidenceState } from '#shared/evidence-state';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';
import SectionCard from '../shared/SectionCard.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** Drop the card chrome when embedded inside an evidence tab panel. */
  embedded?: boolean;
}>();

const { data, pending, error, failingStep, snapshotUrl } = useTraceSnapshots(() => props.testRunsCaseId);

const beforeSrc = computed(() =>
  failingStep.value?.screen.before ? snapshotUrl(failingStep.value.callId, 'screen', 'before') : null,
);
const afterSrc = computed(() =>
  failingStep.value?.screen.after ? snapshotUrl(failingStep.value.callId, 'screen', 'after') : null,
);
const hasPair = computed(() => Boolean(beforeSrc.value));

// Only present the card for a 1.63 trace that recorded snapshots — a run whose
// trace carries none (or none at all) never sees an "enable it" nag here.
const render = computed(() => pending.value || hasPair.value || data.value?.status === 'ok');

const emit = defineEmits<{ available: [value: boolean] }>();
const available = computed(() => !pending.value && !error.value && hasPair.value);
watch(available, (value) => emit('available', value), { immediate: true });

// A 1.63 trace that recorded aria but not screen: nudge toward enabling screen.
const emptyState = computed<EvidenceState>(() => ({
  state: 'not-captured',
  title: 'Before the failing action',
  description: 'Screenshots before the failing action are not captured — enable screen trace snapshots.',
  to: '/setup',
  toLabel: 'Open setup',
}));
</script>

<template>
  <SectionCard v-if="render" :embedded="embedded" icon="i-lucide-image" title="Before the failing action">
    <LoadingState v-if="pending" text="Loading trace screenshots…" />

    <div v-else-if="hasPair" class="grid gap-4" :class="afterSrc ? 'sm:grid-cols-2' : ''">
      <figure class="min-w-0">
        <figcaption class="mb-1 text-[11px] font-medium text-muted">Before the failing action</figcaption>
        <img
          :src="beforeSrc!"
          alt="Page before the failing action"
          loading="lazy"
          class="w-full rounded border border-default bg-elevated object-contain"
        />
      </figure>
      <figure v-if="afterSrc" class="min-w-0">
        <figcaption class="mb-1 text-[11px] font-medium text-muted">At the failure</figcaption>
        <img
          :src="afterSrc"
          alt="Page at the failure"
          loading="lazy"
          class="w-full rounded border border-default bg-elevated object-contain"
        />
      </figure>
    </div>

    <EvidenceEmptyState v-else :state="emptyState" doc="/evidence" compact />
  </SectionCard>
</template>
