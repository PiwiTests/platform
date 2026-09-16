<script setup lang="ts">
/**
 * The "What changed" card of the cluster page: the baseline picker, the commit
 * browser and the diff between the baseline and the failing run. It renders only
 * with something to show — a resolved diff or a hand-picked commit range; the
 * situation block's "What changed" line (`WhatChangedLine`) sums the range up
 * and, with nothing to diff, says why and offers the browser instead.
 */
const {
  clusterId,
  baseCommit,
  selectedCommitShas,
  autoSelectedCommits,
  baseCommitIsPinned,
  scmChanges,
  contextLoading,
  hasChangesToShow,
  refreshContext,
} = useClusterDiagnosis();

const commitBrowserOpen = ref(false);
</script>

<template>
  <SectionCard v-if="hasChangesToShow" icon="i-lucide-git-compare-arrows" title="What changed" help="cluster.scm">
    <div class="space-y-3">
      <div class="pb-2 border-b border-default">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-gray-500 font-medium shrink-0 inline-flex items-center gap-1">
            Baseline <HelpHint topic="cluster.baseline" />
          </span>
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
              :loading="contextLoading"
              @click="refreshContext"
            />
          </div>
        </div>
      </div>

      <div v-if="contextLoading && !scmChanges" class="flex items-center justify-center py-6">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-gray-400" />
      </div>
      <ScmChangesView v-else-if="scmChanges" :changes="scmChanges" />
    </div>
    <CommitBrowserModal
      v-model:open="commitBrowserOpen"
      :cluster-id="clusterId"
      :initial-selected="selectedCommitShas"
      :auto-selected-shas="autoSelectedCommits"
      @confirm="selectedCommitShas = $event"
    />
  </SectionCard>
</template>
