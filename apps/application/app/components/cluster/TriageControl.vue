<script setup lang="ts">
/**
 * Triage for a failure cluster, inline in the page header: a segmented control
 * that sets the triage status on click (no Save button), a note popover with its
 * own save, and — beside them — the fix-verification badge with one sentence.
 * When the human status and the machine-observed fix verification disagree, a
 * reconcile action offers the obvious next state (mark resolved once a fix is
 * verified, reopen once it regressed).
 *
 * Reporter/admin only: a viewer without write access sees the status and note as
 * read-only text.
 */
import type { FailureClusterDetail } from '~~/types/api';
import { isCurrentlySnoozed, isSnoozedBack, type SnoozeOption } from '#shared/inbox-queues';

const props = defineProps<{
  cluster: FailureClusterDetail;
  /** Reporter/admin — whether status and note can be edited. */
  canWrite: boolean;
}>();

const emit = defineEmits<{ saved: [] }>();

const STATUS_OPTIONS = [
  { label: 'Open', value: 'open', color: 'warning' as const },
  { label: 'Resolved', value: 'resolved', color: 'success' as const },
  { label: 'Ignored', value: 'ignored', color: 'neutral' as const },
];

const status = ref(props.cluster.status ?? 'open');
const note = ref(props.cluster.triageNote ?? '');
watch(
  () => props.cluster.status,
  (v) => {
    if (v) status.value = v;
  },
);
watch(
  () => props.cluster.triageNote,
  (v) => {
    note.value = v ?? '';
  },
);

const toast = useToast();
const savingStatus = ref(false);
const savingNote = ref(false);
const noteOpen = ref(false);

async function patch(body: { status?: string; triageNote?: string | null }) {
  return $fetch(`/api/failure-clusters/${props.cluster.id}/status`, {
    method: 'PATCH',
    body: { status: body.status ?? status.value, triageNote: body.triageNote ?? (note.value.trim() || null) },
  });
}

async function setStatus(next: string) {
  if (!props.canWrite || next === status.value || savingStatus.value) return;
  const previous = status.value;
  status.value = next;
  savingStatus.value = true;
  try {
    await patch({ status: next });
    toast.add({ title: `Marked ${formatTriageStatus(next)}`, color: 'success' });
    emit('saved');
  } catch {
    status.value = previous;
    toast.add({ title: 'Could not update triage status', color: 'error' });
  } finally {
    savingStatus.value = false;
  }
}

async function saveNote() {
  if (!props.canWrite || savingNote.value) return;
  savingNote.value = true;
  try {
    await patch({ triageNote: note.value.trim() || null });
    toast.add({ title: 'Triage note saved', color: 'success' });
    noteOpen.value = false;
    emit('saved');
  } catch {
    toast.add({ title: 'Could not save the note', color: 'error' });
  } finally {
    savingNote.value = false;
  }
}

const hasNote = computed(() => Boolean((props.cluster.triageNote ?? '').trim()));

// ── Fix verification ────────────────────────────────────────────────────────
const verification = computed(() => fixVerificationBadge(props.cluster.fixVerification));

/** One sentence describing the machine-observed fix verification. */
const verificationSentence = computed(() => {
  const c = props.cluster;
  if (!c.fixVerification) return null;
  const run = c.fixLandedRunId ? `run #${c.fixLandedRunId}` : 'a later run';
  const commit = c.fixCommit ? ` · commit ${c.fixCommit.slice(0, 8)}` : '';
  switch (c.fixVerification) {
    case 'diagnosis-verified': {
      const open = c.timeToResolutionMs != null ? ` — open ${formatLongDuration(c.timeToResolutionMs)}` : '';
      return `Fix verified in ${run}${open}${commit}`;
    }
    case 'stopped-failing':
      return `Stopped failing in ${run}${commit}`;
    case 'regressed':
      return `Regressed after ${run}${commit}`;
    default:
      return null;
  }
});

/** Whether the human status and the fix verification point at different states. */
const reconcile = computed<{ label: string; to: string } | null>(() => {
  const v = props.cluster.fixVerification;
  if ((v === 'diagnosis-verified' || v === 'stopped-failing') && status.value === 'open')
    return { label: 'Mark resolved', to: 'resolved' };
  if (v === 'regressed' && status.value === 'resolved') return { label: 'Reopen', to: 'open' };
  return null;
});

// ── Snooze ──────────────────────────────────────────────────────────────────
// Snooze hides a cluster from every inbox queue without touching its status.
const snoozing = ref(false);
const snoozed = computed(() => isCurrentlySnoozed(props.cluster));
const snoozedBack = computed(() => isSnoozedBack(props.cluster));
const snoozeLabel = computed(() => {
  if (props.cluster.snoozeMode === 'until-recurs') return 'Snoozed until it recurs';
  const until = props.cluster.snoozedUntil;
  return until ? `Snoozed until ${prettyDateFormat(until)}` : 'Snoozed';
});

const SNOOZE_ITEMS = [
  [
    { label: '1 day', onSelect: () => void snooze('1-day') },
    { label: '1 week', onSelect: () => void snooze('1-week') },
    { label: 'Until it recurs', onSelect: () => void snooze('until-recurs') },
  ],
];

async function snooze(option: SnoozeOption | null) {
  if (!props.canWrite || snoozing.value) return;
  snoozing.value = true;
  try {
    await $fetch(`/api/failure-clusters/${props.cluster.id}/snooze`, { method: 'PATCH', body: { snooze: option } });
    toast.add({ title: option ? 'Cluster snoozed' : 'Cluster unsnoozed', color: 'success' });
    emit('saved');
  } catch {
    toast.add({ title: 'Could not update the snooze', color: 'error' });
  } finally {
    snoozing.value = false;
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <!-- Triage status -->
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-muted inline-flex items-center gap-1 shrink-0">
        Triage <HelpHint topic="cluster.triage" />
      </span>
      <div
        v-if="canWrite"
        class="inline-flex rounded-md border border-default overflow-hidden"
        role="group"
        aria-label="Triage status"
      >
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          type="button"
          class="px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-primary -ml-px first:ml-0 border-l border-default first:border-l-0 disabled:opacity-60"
          :class="
            status === opt.value
              ? {
                  'bg-warning/15 text-warning': opt.color === 'warning',
                  'bg-success/15 text-success': opt.color === 'success',
                  'bg-elevated text-highlighted': opt.color === 'neutral',
                }
              : 'text-muted hover:bg-elevated/60'
          "
          :aria-pressed="status === opt.value ? 'true' : 'false'"
          :disabled="savingStatus"
          @click="setStatus(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
      <UBadge v-else :color="clusterStatusColor(status)" variant="subtle" size="sm">
        {{ formatTriageStatus(status) }}
      </UBadge>

      <!-- Note -->
      <UPopover v-if="canWrite" v-model:open="noteOpen">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="hasNote ? 'i-lucide-sticky-note' : 'i-lucide-square-pen'"
          :class="hasNote ? 'text-primary' : ''"
          :title="hasNote ? 'Edit triage note' : 'Add a triage note'"
          aria-label="Triage note"
        />
        <template #content>
          <div class="p-3 space-y-2 w-72">
            <UTextarea
              v-model="note"
              placeholder="Optional note…"
              :rows="3"
              class="w-full"
              autofocus
              @keydown.meta.enter="saveNote"
            />
            <div class="flex justify-end">
              <UButton size="xs" icon="i-lucide-check" :loading="savingNote" @click="saveNote">Save note</UButton>
            </div>
          </div>
        </template>
      </UPopover>
      <UTooltip v-else-if="hasNote" :text="note">
        <UIcon name="i-lucide-sticky-note" class="size-4 text-muted" />
      </UTooltip>
    </div>

    <!-- Fix verification -->
    <div v-if="verification" class="flex flex-wrap items-center gap-2 text-xs">
      <UBadge :color="verification.color" variant="subtle" size="sm" class="gap-1 shrink-0">
        <UIcon :name="verification.icon" class="size-3" />
        {{ verification.label }}
      </UBadge>
      <span class="text-muted">{{ verificationSentence }}</span>
      <HelpHint topic="cluster.fix-verification" />
      <UButton
        v-if="reconcile && canWrite"
        size="xs"
        color="primary"
        variant="soft"
        :loading="savingStatus"
        @click="setStatus(reconcile.to)"
      >
        {{ reconcile.label }}
      </UButton>
    </div>

    <!-- Snooze -->
    <div class="flex items-center gap-2 text-xs">
      <template v-if="snoozed">
        <UBadge color="info" variant="subtle" size="sm" class="gap-1 shrink-0">
          <UIcon name="i-lucide-alarm-clock" class="size-3" />
          {{ snoozeLabel }}
        </UBadge>
        <HelpHint topic="cluster.snooze" />
        <UButton
          v-if="canWrite"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-alarm-clock-off"
          :loading="snoozing"
          @click="snooze(null)"
        >
          Unsnooze
        </UButton>
      </template>
      <template v-else>
        <UBadge v-if="snoozedBack" color="info" variant="subtle" size="sm" class="gap-1 shrink-0">
          <UIcon name="i-lucide-alarm-clock" class="size-3" />
          Snoozed, back
        </UBadge>
        <UDropdownMenu v-if="canWrite" :items="SNOOZE_ITEMS">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-clock"
            trailing-icon="i-lucide-chevron-down"
            :loading="snoozing"
          >
            Snooze
          </UButton>
        </UDropdownMenu>
      </template>
    </div>
  </div>
</template>
