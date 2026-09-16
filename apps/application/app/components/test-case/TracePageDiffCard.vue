<script setup lang="ts">
/**
 * In-execution structural page diff — the failing action's page *before* it ran
 * against the page *at the failure* (the modal that stayed open, the table that
 * emptied). Read straight from this run's trace aria snapshots, so it needs no
 * green baseline. Complements the vs-last-green PageDiffCard.
 */
import { formatPageDiffSummary } from '#shared/page-diff';
import type { EvidenceState } from '#shared/evidence-state';
import { useTraceSnapshots } from '~/composables/useTraceSnapshots';
import SectionCard from '../shared/SectionCard.vue';
import PageDiffHunkList from './PageDiffHunkList.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** Drop the card chrome when embedded inside an evidence tab panel. */
  embedded?: boolean;
}>();

const { data, pending, error, hasAria } = useTraceSnapshots(() => props.testRunsCaseId);

const pageDiff = computed(() => (data.value?.status === 'ok' ? (data.value.pageDiff ?? null) : null));
const hunks = computed(() => pageDiff.value?.hunks ?? []);
const summaryText = computed(() => (pageDiff.value ? formatPageDiffSummary(pageDiff.value.summary) : ''));

// Only present the card for a 1.63 trace that recorded aria snapshots — a run
// whose trace carries none is served by the vs-green diff below, not a nag here.
const render = computed(
  () => pending.value || pageDiff.value != null || (data.value?.status === 'ok' && hasAria.value),
);

// The tab reads `available` to show the Screenshot · Page diff toggle for
// exactly the condition under which this diff renders.
const emit = defineEmits<{ available: [value: boolean] }>();
const available = computed(() => !pending.value && !error.value && pageDiff.value != null);
watch(available, (value) => emit('available', value), { immediate: true });

// Aria was recorded but the failing action's page never differed from an earlier
// one — nothing structural to show.
const emptyState = computed<EvidenceState>(() => ({
  state: 'not-applicable',
  title: 'Page diff',
  description: 'The page structure did not change on the way to this failure — not applicable here.',
}));
</script>

<template>
  <SectionCard v-if="render" :embedded="embedded" icon="i-lucide-file-diff" title="Page diff" help="case.page-diff">
    <template v-if="available" #subtitle>
      <span>before the failing action → at the failure</span>
    </template>
    <template v-if="available" #actions>
      <UBadge color="neutral" variant="subtle" size="sm" class="font-mono tabular-nums">{{ summaryText }}</UBadge>
    </template>

    <LoadingState v-if="pending" text="Comparing the page before and at the failure…" />

    <template v-else-if="available">
      <!-- No structural change is positive evidence — state it explicitly. -->
      <UAlert
        v-if="hunks.length === 0"
        color="success"
        icon="i-lucide-check-circle"
        variant="subtle"
        description="The page structure did not change while the failing action ran — a structural change is unlikely to explain this failure."
      />
      <PageDiffHunkList v-else :hunks="hunks" />
    </template>

    <EvidenceEmptyState v-else :state="emptyState" doc="/evidence" compact />
  </SectionCard>
</template>
