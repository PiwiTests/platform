<script setup lang="ts">
/**
 * A failure cluster's state as one sentence with one verb: a coloured dot for the
 * kind, the sentence's typed spans as prose (run references linked), the single
 * reconcile action the machine verdict and the human status imply (mark resolved,
 * reopen, unsnooze, release), and two menus — Triage (open / resolved / ignored,
 * a note, an assignee) and Snooze. It replaces the segmented control, the note
 * icon, the verification badge and its sentence, and the snooze row.
 *
 * Every save toasts and asks the page to refresh; a viewer without write access
 * sees the sentence alone.
 */
import type { FailureClusterDetail } from '~~/types/api';
import type { ClusterState, ClusterStateKind, ClusterStateAction } from '#shared/cluster-state';
import { SNOOZE_OPTIONS, type SnoozeOption } from '#shared/inbox-queues';

const props = defineProps<{
  cluster: FailureClusterDetail;
  state: ClusterState;
  /** Reporter/admin — whether the state can be changed. */
  canWrite: boolean;
}>();

const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const { hasTracker } = useTrackerStatus();

// The tracker issue this cluster is already known by, if any — a link the
// dashboard created or a person pinned that carries a key.
const knownIssue = computed(() =>
  (props.cluster.links ?? []).find((l) => (l.provider === 'jira' || l.connectionId != null) && l.key),
);

const issueModalOpen = ref(false);
function onIssueCreated() {
  issueModalOpen.value = false;
  emit('saved');
}

// The dot colour reads the state at a glance: red still-failing, green fixed,
// amber quiet or parked, neutral resolved / ignored / snoozed.
const DOT: Record<ClusterStateKind, string> = {
  failing: 'bg-error',
  'failing-assigned': 'bg-error',
  regressed: 'bg-error',
  quiet: 'bg-warning',
  quarantined: 'bg-warning',
  'fix-verified-open': 'bg-success',
  'stopped-failing-open': 'bg-success',
  resolved: 'bg-success',
  ignored: 'bg-muted',
  snoozed: 'bg-muted',
};
const dotClass = computed(() => DOT[props.state.kind] ?? 'bg-muted');

const RECONCILE_LABEL: Record<Exclude<ClusterStateAction, null>, string> = {
  'mark-resolved': 'Mark resolved',
  reopen: 'Reopen',
  unsnooze: 'Unsnooze',
  release: 'Release',
};
const reconcileLabel = computed(() => (props.state.action ? RECONCILE_LABEL[props.state.action] : null));

const busy = ref(false);

async function patchStatus(status: string, triageNote?: string | null) {
  return $fetch(`/api/failure-clusters/${props.cluster.id}/status`, {
    method: 'PATCH',
    body: { status, triageNote: triageNote !== undefined ? triageNote : (props.cluster.triageNote ?? null) },
  });
}
async function patchSnooze(option: SnoozeOption | null) {
  return $fetch(`/api/failure-clusters/${props.cluster.id}/snooze`, { method: 'PATCH', body: { snooze: option } });
}

// ── The one reconcile action ─────────────────────────────────────────────────
const { releaseOne } = useQuarantine(() => props.cluster.project?.id ?? null);
// Mark resolved / reopen share the failure pages' triage helper, preserving the
// existing note through the status PATCH.
const { setClusterStatus } = useClusterTriage(() => props.cluster.id, {
  currentNote: () => props.cluster.triageNote,
  onSaved: () => emit('saved'),
});

async function runReconcile() {
  if (!props.canWrite || busy.value || !props.state.action) return;
  busy.value = true;
  try {
    switch (props.state.action) {
      case 'mark-resolved':
        await setClusterStatus('resolved');
        break;
      case 'reopen':
        await setClusterStatus('open');
        break;
      case 'unsnooze':
        await patchSnooze(null);
        toast.add({ title: 'Cluster unsnoozed', color: 'success' });
        emit('saved');
        break;
      case 'release': {
        const quarantined = (props.cluster.affectedTestCases ?? []).filter((c) => c.quarantined);
        for (const c of quarantined) await releaseOne(c.testCaseId);
        emit('saved');
        break;
      }
    }
  } catch {
    toast.add({ title: 'Could not update the cluster', color: 'error' });
  } finally {
    busy.value = false;
  }
}

// ── Triage popover: status, note and assignee in one small panel ─────────────
const triageOpen = ref(false);
const draftStatus = ref(props.cluster.status ?? 'open');
const draftNote = ref(props.cluster.triageNote ?? '');
const draftAssignee = ref(props.cluster.assignee ?? '');
watch(triageOpen, (open) => {
  if (open) {
    draftStatus.value = props.cluster.status ?? 'open';
    draftNote.value = props.cluster.triageNote ?? '';
    draftAssignee.value = props.cluster.assignee ?? '';
  }
});

const STATUS_OPTIONS = [
  { label: 'Open', value: 'open', color: 'warning' as const },
  { label: 'Resolved', value: 'resolved', color: 'success' as const },
  { label: 'Ignored', value: 'ignored', color: 'neutral' as const },
];

const savingTriage = ref(false);
async function saveTriage() {
  if (!props.canWrite || savingTriage.value) return;
  savingTriage.value = true;
  try {
    const note = draftNote.value.trim() || null;
    if (draftStatus.value !== props.cluster.status || note !== (props.cluster.triageNote ?? null)) {
      await patchStatus(draftStatus.value, note);
    }
    const assignee = draftAssignee.value.trim() || null;
    if (assignee !== (props.cluster.assignee ?? null)) {
      await $fetch(`/api/failure-clusters/${props.cluster.id}/assignee`, { method: 'PATCH', body: { assignee } });
    }
    toast.add({ title: 'Triage saved', color: 'success' });
    triageOpen.value = false;
    emit('saved');
  } catch {
    toast.add({ title: 'Could not save triage', color: 'error' });
  } finally {
    savingTriage.value = false;
  }
}

// ── Snooze menu ──────────────────────────────────────────────────────────────
const SNOOZE_LABEL: Record<SnoozeOption, string> = {
  '1-day': '1 day',
  '1-week': '1 week',
  'until-recurs': 'Until it recurs',
};
const snoozing = ref(false);
async function snooze(option: SnoozeOption | null) {
  if (!props.canWrite || snoozing.value) return;
  snoozing.value = true;
  try {
    await patchSnooze(option);
    toast.add({ title: option ? 'Cluster snoozed' : 'Cluster unsnoozed', color: 'success' });
    emit('saved');
  } catch {
    toast.add({ title: 'Could not update the snooze', color: 'error' });
  } finally {
    snoozing.value = false;
  }
}
const isSnoozed = computed(() => props.state.kind === 'snoozed');
const snoozeItems = computed(() => [
  [
    ...SNOOZE_OPTIONS.map((o) => ({ label: SNOOZE_LABEL[o], onSelect: () => void snooze(o) })),
    ...(isSnoozed.value ? [{ label: 'Unsnooze', onSelect: () => void snooze(null) }] : []),
  ],
]);
</script>

<template>
  <div data-shot="cluster-state" class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
    <!-- The sentence as prose, run references linked; the dot is part of it so it stays on its first line. -->
    <span data-shot="cluster-state-sentence" class="min-w-0">
      <span class="inline-block size-2 rounded-full mr-1.5 align-middle" :class="dotClass" aria-hidden="true" />
      <template v-for="(part, i) in state.parts" :key="i">
        <NuxtLink
          v-if="part.kind === 'run' && part.href"
          :to="part.href"
          :class="[SENTENCE_LINK_CLASS, 'tabular-nums']"
          >{{ part.text }}</NuxtLink
        >
        <template v-else>{{ part.text }}</template>
      </template>
    </span>

    <!-- The known issue chip, shown to everyone once the cluster is tracked. -->
    <span
      v-if="knownIssue"
      data-shot="cluster-issue-chip"
      class="inline-flex items-center shrink-0"
      :class="canWrite ? '' : 'ml-auto'"
    >
      <LinkChip :link="knownIssue" />
    </span>

    <div v-if="canWrite" class="flex items-center gap-1.5 ml-auto shrink-0">
      <!-- Create issue is the primary action while the cluster has no ticket. -->
      <UButton
        v-if="hasTracker && !knownIssue"
        size="xs"
        icon="i-simple-icons-jira"
        data-shot="cluster-create-issue"
        @click="issueModalOpen = true"
      >
        Create issue
      </UButton>
      <UButton
        v-else-if="knownIssue"
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-simple-icons-jira"
        :to="knownIssue.url"
        target="_blank"
      >
        Open in Jira
      </UButton>

      <!-- The one reconcile action the state implies. -->
      <UButton
        v-if="state.action && reconcileLabel"
        size="xs"
        color="neutral"
        variant="outline"
        :loading="busy"
        @click="runReconcile"
      >
        {{ reconcileLabel }}
      </UButton>

      <!-- Triage: status, note and assignee. -->
      <UPopover v-model:open="triageOpen">
        <UButton size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down"> Triage </UButton>
        <template #content>
          <div class="p-3 space-y-3 w-72">
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted">Status</p>
              <div class="inline-flex rounded-md border border-default overflow-hidden" role="group">
                <button
                  v-for="opt in STATUS_OPTIONS"
                  :key="opt.value"
                  type="button"
                  class="px-2.5 py-1 text-xs font-medium transition-colors -ml-px first:ml-0 border-l border-default first:border-l-0"
                  :class="
                    draftStatus === opt.value
                      ? {
                          'bg-warning/15 text-warning': opt.color === 'warning',
                          'bg-success/15 text-success': opt.color === 'success',
                          'bg-elevated text-highlighted': opt.color === 'neutral',
                        }
                      : 'text-muted hover:bg-elevated/60'
                  "
                  :aria-pressed="draftStatus === opt.value ? 'true' : 'false'"
                  @click="draftStatus = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted">Note</p>
              <UTextarea v-model="draftNote" placeholder="Optional note…" :rows="2" class="w-full" />
            </div>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted">Assign to</p>
              <UInput v-model="draftAssignee" placeholder="Name or email…" size="sm" class="w-full" />
            </div>
            <div class="flex justify-end">
              <UButton size="xs" icon="i-lucide-check" :loading="savingTriage" @click="saveTriage">Save</UButton>
            </div>
          </div>
        </template>
      </UPopover>

      <!-- Snooze. -->
      <UDropdownMenu :items="snoozeItems">
        <UButton size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-chevron-down" :loading="snoozing">
          Snooze
        </UButton>
      </UDropdownMenu>
    </div>

    <CreateIssueModal
      v-model:open="issueModalOpen"
      entity-type="failure_cluster"
      :entity-id="cluster.id"
      @created="onIssueCreated"
      @linked="onIssueCreated"
    />
  </div>
</template>
