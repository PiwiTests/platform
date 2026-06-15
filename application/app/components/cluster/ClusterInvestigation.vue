<script setup lang="ts">
import type { DiagnosisContextCoverage, ScmChanges } from '~~/types/api';

const props = defineProps<{
  clusterId: number;
}>();

const emit = defineEmits<{
  baseCommitChange: [sha: string];
  selectedCommitsChange: [shas: string[]];
}>();

const baseCommit = ref('');
const savedBaseCommit = ref('');
const selectedCommitShas = ref<string[]>([]);
const contextText = ref<string | null>(null);
const coverage = ref<DiagnosisContextCoverage | null>(null);
const scmChanges = ref<ScmChanges | null>(null);
const loadingContext = ref(false);
const commitBrowserOpen = ref(false);

const baseCommitIsPinned = computed(() => !!savedBaseCommit.value);

const scmStatus = computed(() => {
  const scm = coverage.value?.scm;
  if (!scm) return { color: 'text-gray-400', icon: 'i-lucide-git-branch', text: 'Git context unavailable', detail: '' };

  if (scm.baseCommitUsed) {
    if (scm.filesCount === 0) {
      return {
        color: 'text-yellow-500',
        icon: 'i-lucide-git-branch-plus',
        text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · fetch failed`,
        detail: 'network error or missing SCM token (check AI settings)',
      };
    }
    const patchNote = scm.patchesOmitted
      ? ', no patches (diff too large)'
      : scm.patchesTruncated
        ? `, ${scm.patchedFilesCount} with patches (some cut)`
        : `, ${scm.patchedFilesCount} with patches`;
    return {
      color: 'text-blue-500',
      icon: 'i-lucide-git-branch-plus',
      text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · ${scm.filesCount} files${patchNote}`,
      detail: scm.hasLastGreen ? 'overrides last passing run baseline' : 'no last passing run',
    };
  }

  if (!scm.hasLastGreen)
    return {
      color: 'text-gray-400',
      icon: 'i-lucide-git-branch',
      text: 'No last passing run',
      detail: 'enter a baseline commit below to enable diff',
    };
  if (!scm.hasCommitRange)
    return {
      color: 'text-gray-400',
      icon: 'i-lucide-git-branch',
      text: 'No commit range',
      detail: 'reporter did not send SCM metadata',
    };
  if (!scm.provider)
    return {
      color: 'text-yellow-500',
      icon: 'i-lucide-git-branch',
      text: 'Unsupported SCM host',
      detail: 'only GitHub, GitLab and Bitbucket are supported',
    };
  if (scm.filesCount === 0)
    return {
      color: 'text-yellow-500',
      icon: 'i-lucide-git-branch',
      text: `${scm.provider} · fetch failed`,
      detail: 'network error or missing SCM token (check AI settings)',
    };
  if (scm.patchesOmitted) {
    return {
      color: 'text-yellow-500',
      icon: 'i-lucide-git-branch',
      text: `${scm.provider} · ${scm.filesCount} files`,
      detail: 'diff too large — file list only, no patches',
    };
  }
  const patchNote = scm.patchesTruncated ? ', some patches cut (budget)' : '';
  const commitNote = scm.commitsCount > 0 ? ` · ${scm.commitsCount} commit${scm.commitsCount > 1 ? 's' : ''}` : '';
  return {
    color: 'text-green-500',
    icon: 'i-lucide-git-branch',
    text: `${scm.provider} · ${scm.filesCount} files · ${scm.patchedFilesCount} with patches${patchNote}${commitNote}`,
    detail: '',
  };
});

async function fetchContext() {
  loadingContext.value = true;
  contextText.value = null;
  coverage.value = null;
  scmChanges.value = null;
  try {
    const query: Record<string, string | string[]> = {};
    if (baseCommit.value.trim()) query.baseCommit = baseCommit.value.trim();
    if (selectedCommitShas.value.length) query.selectedCommitShas = selectedCommitShas.value;
    const res = await $fetch<{ context: string; coverage: DiagnosisContextCoverage; scmChanges: ScmChanges | null }>(
      `/api/failure-clusters/${props.clusterId}/context`,
      { query },
    );
    contextText.value = res.context;
    coverage.value = res.coverage;
    scmChanges.value = res.scmChanges ?? null;
  } catch {
    contextText.value = '(failed to load context)';
  } finally {
    loadingContext.value = false;
  }
}

async function persistBaseCommit(sha: string) {
  try {
    await $fetch(`/api/failure-clusters/${props.clusterId}/base-commit`, {
      method: 'PATCH',
      body: { commit: sha || null },
    });
    savedBaseCommit.value = sha;
  } catch {
    /* ignore — non-critical */
  }
}

let baseCommitTimer: ReturnType<typeof setTimeout> | null = null;
let initializing = true;

watch(baseCommit, (val) => {
  if (initializing) return;
  if (baseCommitTimer) clearTimeout(baseCommitTimer);
  baseCommitTimer = setTimeout(() => {
    fetchContext();
  }, 900);
  if (val !== savedBaseCommit.value) persistBaseCommit(val);
  emit('baseCommitChange', val);
});

watch(
  selectedCommitShas,
  (val) => {
    if (initializing) return;
    fetchContext();
    emit('selectedCommitsChange', [...val]);
  },
  { deep: true },
);

onMounted(async () => {
  try {
    const res = await $fetch<{ diagnosis: unknown; manualBaseCommit: string | null }>(
      `/api/failure-clusters/${props.clusterId}/diagnosis`,
    );
    if (res.manualBaseCommit) {
      savedBaseCommit.value = res.manualBaseCommit;
      baseCommit.value = res.manualBaseCommit;
      emit('baseCommitChange', res.manualBaseCommit);
    }
  } catch {
    /* ignore */
  }
  initializing = false;
  fetchContext();
});

onUnmounted(() => {
  if (baseCommitTimer) clearTimeout(baseCommitTimer);
});
</script>

<template>
  <div class="space-y-3">
    <div class="pb-2 border-b border-default">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs text-gray-500 font-medium shrink-0">Baseline</span>
        <CommitPicker v-model="baseCommit" :cluster-id="clusterId" />
        <UTooltip v-if="baseCommitIsPinned" text="Baseline commit pinned for this cluster">
          <UIcon name="i-lucide-pin" class="size-3.5 text-primary shrink-0" />
        </UTooltip>
        <div class="flex items-center gap-1.5 ml-auto">
          <div
            v-if="selectedCommitShas.length"
            class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
          >
            <UIcon name="i-lucide-git-commit-horizontal" class="size-3" />
            <span>{{ selectedCommitShas.length }} commit{{ selectedCommitShas.length === 1 ? '' : 's' }}</span>
            <button class="ml-0.5 hover:opacity-70 transition-opacity" @click="selectedCommitShas = []">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </div>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-list" @click="commitBrowserOpen = true">
            Browse
          </UButton>
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="loadingContext"
            @click="fetchContext"
          />
        </div>
      </div>
    </div>

    <div
      v-if="coverage"
      class="flex items-start gap-1.5 text-xs px-2 py-1.5 rounded-md bg-elevated border border-default"
    >
      <UIcon :name="scmStatus.icon" class="size-3.5 mt-0.5 shrink-0" :class="scmStatus.color" />
      <div>
        <span :class="scmStatus.color">{{ scmStatus.text }}</span>
        <span v-if="scmStatus.detail" class="text-gray-400 ml-1">— {{ scmStatus.detail }}</span>
      </div>
    </div>

    <div v-if="loadingContext && !scmChanges" class="flex items-center justify-center py-6">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
    </div>

    <ScmChangesView v-else-if="scmChanges" :changes="scmChanges" />

    <p v-else-if="coverage && !loadingContext && !scmChanges" class="text-xs text-gray-400 text-center py-4">
      No changes found in this range.
    </p>
  </div>

  <CommitBrowserModal
    v-model:open="commitBrowserOpen"
    :cluster-id="clusterId"
    :initial-selected="selectedCommitShas"
    @confirm="selectedCommitShas = $event"
  />
</template>
