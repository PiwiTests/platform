<script setup lang="ts">
/**
 * Confirms, then deletes one or several test runs — one request per run, in
 * order — and follows the deletion: each run's line goes from waiting to
 * running to deleted (or to its error), a bar counts the runs and a clock
 * shows the time spent. Kept runs are named and skipped. The modal cannot be
 * dismissed while it deletes; a deletion of several runs can be stopped after
 * the current run, and leaving the page stops it the same way. On success it
 * closes with a toast; when a run could not be deleted it stays open on the
 * list so the errors can be read.
 */
import type { TestRunSummary } from '~~/types/api';

type RunRef = Pick<TestRunSummary, 'id' | 'keptAt'>;
type LineState = 'waiting' | 'pending' | 'ok' | 'error';
interface Line {
  id: number;
  state: LineState;
  message?: string;
}

const props = defineProps<{ runs: RunRef[] }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ deleted: [runIds: number[]] }>();

const toast = useToast();
const phase = ref<'confirm' | 'deleting' | 'failed'>('confirm');
const lines = ref<Line[]>([]);
const stopRequested = ref(false);
const elapsedMs = ref(0);
let clock: ReturnType<typeof setInterval> | undefined;

const deletable = computed(() => props.runs.filter((r) => !r.keptAt));
const kept = computed(() => props.runs.filter((r) => r.keptAt));

watch(open, (isOpen) => {
  if (!isOpen || phase.value === 'deleting') return;
  phase.value = 'confirm';
  lines.value = [];
});

onBeforeUnmount(() => {
  stopRequested.value = true;
  clearInterval(clock);
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "#12", "#12 and #13", "#12, #13 and #15", "#12, #13, … and 20 more". */
function listRuns(runs: RunRef[]): string {
  const ids = runs.map((r) => `#${r.id}`);
  if (ids.length <= 1) return ids.join('');
  const shown = ids.length > 8 ? ids.slice(0, 6) : ids.slice(0, -1);
  const tail = ids.length > 8 ? `${ids.length - 6} more` : ids.at(-1);
  return `${shown.join(', ')} and ${tail}`;
}

const total = computed(() => lines.value.length);
const finished = computed(() => lines.value.filter((l) => l.state === 'ok' || l.state === 'error').length);
const current = computed(() => lines.value.find((l) => l.state === 'pending'));

const title = computed(() => {
  const n = phase.value === 'confirm' ? deletable.value.length : total.value;
  const single = n === 1 ? `run #${(phase.value === 'confirm' ? deletable.value[0] : lines.value[0])?.id}` : null;
  if (phase.value === 'deleting') return single ? `Deleting ${single}` : `Deleting ${plural(n, 'run')}`;
  if (phase.value === 'failed')
    return single ? `Run #${lines.value[0]?.id} was not deleted` : 'Some runs were not deleted';
  if (n === 0) return kept.value.length === 1 ? `Delete run #${kept.value[0]?.id}` : 'Delete runs';
  return single ? `Delete ${single}` : `Delete ${plural(n, 'run')}`;
});

const confirmText = computed(() => {
  const n = deletable.value.length;
  if (n === 0) return 'Kept runs cannot be deleted until they are released.';
  const what = n === 1 ? `Run #${deletable.value[0]!.id}` : `${plural(n, 'run')} — ${listRuns(deletable.value)} —`;
  return `${what} and ${n === 1 ? 'its' : 'their'} test results, reports, traces and screenshots will be permanently deleted. This cannot be undone.`;
});

const keptText = computed(() => {
  const n = kept.value.length;
  if (n === 0 || deletable.value.length === 0) return null;
  return n === 1
    ? `Run #${kept.value[0]!.id} is kept forever and will be skipped.`
    : `${plural(n, 'run')} kept forever will be skipped: ${listRuns(kept.value)}.`;
});

/** Share of runs done while several are deleted; null (an indeterminate bar) for one. */
const barValue = computed(() => (total.value > 1 ? Math.round((finished.value / total.value) * 100) : null));

const statusText = computed(() => {
  const parts: string[] = [];
  if (phase.value === 'failed') {
    if (total.value > 1) parts.push(`${lines.value.filter((l) => l.state === 'ok').length} of ${total.value} deleted`);
  } else if (total.value > 1) {
    parts.push(`${finished.value} of ${total.value} done`);
  } else {
    parts.push('Removing its test results, reports, traces and screenshots');
  }
  if (phase.value === 'deleting' && elapsedMs.value >= 1000) {
    parts.push(`running for ${formatLongDuration(elapsedMs.value)}`);
  }
  if (phase.value === 'deleting' && stopRequested.value) parts.push('stopping after the current run');
  const line = parts.join(' · ');
  return line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : '';
});

function errorOf(error: unknown): { status?: number; message: string } {
  const e = error as { statusCode?: number; data?: { message?: string } } | null;
  return { status: e?.statusCode, message: e?.data?.message || 'An error occurred' };
}

async function deleteRuns() {
  if (phase.value === 'deleting' || deletable.value.length === 0) return;
  lines.value = deletable.value.map((r) => ({ id: r.id, state: 'waiting' }));
  stopRequested.value = false;
  phase.value = 'deleting';
  const startedAt = Date.now();
  elapsedMs.value = 0;
  clock = setInterval(() => (elapsedMs.value = Date.now() - startedAt), 1000);

  const deleted: number[] = [];
  try {
    for (const line of lines.value) {
      if (stopRequested.value) break;
      line.state = 'pending';
      try {
        await $fetch(`/api/test-runs/${line.id}`, { method: 'DELETE' });
        line.state = 'ok';
        deleted.push(line.id);
      } catch (error: unknown) {
        const { status, message } = errorOf(error);
        // A run that is already gone ends where the deletion wanted it.
        if (status === 404) {
          line.state = 'ok';
          line.message = 'Already deleted';
          deleted.push(line.id);
        } else {
          line.state = 'error';
          line.message = message;
        }
      }
    }
  } finally {
    clearInterval(clock);
  }

  if (deleted.length) emit('deleted', deleted);
  const failed = lines.value.filter((l) => l.state === 'error').length;
  if (failed) {
    phase.value = 'failed';
    return;
  }
  phase.value = 'confirm';
  open.value = false;
  const stopped = deleted.length < lines.value.length;
  toast.add({
    title: stopped
      ? `Stopped — ${deleted.length} of ${plural(lines.value.length, 'run')} deleted`
      : deleted.length === 1
        ? `Run #${deleted[0]} deleted`
        : `${plural(deleted.length, 'run')} deleted`,
    color: 'success',
  });
}

function close() {
  phase.value = 'confirm';
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :dismissible="phase !== 'deleting'" :close="phase !== 'deleting'">
    <template #body>
      <div v-if="phase === 'confirm'" class="space-y-3">
        <p class="text-sm text-highlighted leading-relaxed">{{ confirmText }}</p>
        <p v-if="keptText" class="text-xs text-muted">{{ keptText }}</p>
      </div>
      <div v-else class="space-y-4" data-shot="runs-delete-progress">
        <UProgress v-if="phase === 'deleting'" :model-value="barValue" size="sm" />
        <div class="max-h-60 overflow-y-auto space-y-2" data-testid="runs-delete-lines">
          <CheckResultLine
            v-for="line in lines"
            :key="line.id"
            :state="line.state"
            :text="`Run #${line.id}`"
            :hint="line.message"
          />
        </div>
        <p v-if="statusText" class="text-xs text-muted">
          {{ statusText }}
          <template v-if="phase === 'deleting' && total > 1">
            Leaving this page stops the deletion after the current run.
          </template>
        </p>
      </div>
    </template>
    <template #footer>
      <template v-if="phase === 'confirm'">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :label="deletable.length > 1 ? `Delete ${plural(deletable.length, 'run')}` : 'Delete'"
          :disabled="deletable.length === 0"
          @click="deleteRuns"
        />
      </template>
      <template v-else-if="phase === 'deleting'">
        <UButton
          v-if="total > 1"
          color="neutral"
          variant="outline"
          :label="stopRequested ? 'Stopping…' : 'Stop'"
          :disabled="stopRequested"
          :title="`Stop after run #${current?.id ?? ''}`"
          @click="stopRequested = true"
        />
        <UButton color="error" icon="i-lucide-trash-2" label="Deleting…" loading />
      </template>
      <UButton v-else color="neutral" variant="outline" label="Close" @click="close" />
    </template>
  </UModal>
</template>
