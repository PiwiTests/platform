<script setup lang="ts">
/**
 * The "What changed" line of the cluster page's situation block: one sentence on
 * the commits between the last passing run and this failure. With a resolved
 * diff or a hand-picked commit range it sums the range up — commits, files, what
 * they are counted from — and links to the full card below the block, where the
 * baseline picker, the commits and the diff live. With nothing to diff it says
 * why (no last passing run, unsupported host, fetch failed) and offers the commit
 * browser where one can work, so a cluster without a baseline is not a dead end:
 * picking commits opens the card.
 */
const { clusterId, coverage, scmChanges, selectedCommitShas, autoSelectedCommits, contextLoading, hasChangesToShow } =
  useClusterDiagnosis();

const emit = defineEmits<{
  /** "See the changes" — the page scrolls to the card below the block. */
  see: [];
}>();

const { scmStatus } = useScmStatusSummary(coverage);
const commitBrowserOpen = ref(false);

// A green or blue status is a diff that resolved; every other color is a reason
// there is none, and the status sentence names it.
const scmHealthy = computed(
  () => scmStatus.value.color === 'text-green-500' || scmStatus.value.color === 'text-blue-500',
);

// The browser lists the repository's commits, which needs a repository the run
// reported and a host we support: with a last passing run the server has said
// which; without one it has not looked, so the browser gets its chance.
const canBrowse = computed(() => {
  const scm = coverage.value?.scm;
  return Boolean(scm && (scm.provider || !scm.hasLastGreen));
});

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What the range is counted from: the last passing run, or the baseline that overrides it. */
const baseline = computed(() => {
  const sha = coverage.value?.scm?.baseCommitUsed;
  return sha ? `baseline ${sha.slice(0, 7)}` : 'the last passing run';
});

/** The range in one clause: how many commits and files, counted from where. */
const summary = computed(() => {
  const changes = scmChanges.value;
  if (!changes) return null;
  const files = `${count(changes.files.length, 'file')} changed`;
  if (selectedCommitShas.value.length) return `${count(selectedCommitShas.value.length, 'selected commit')}, ${files}`;
  if (changes.commits.length) return `${count(changes.commits.length, 'commit')} since ${baseline.value}, ${files}`;
  return `${files} since ${baseline.value}`;
});
</script>

<template>
  <p data-shot="what-changed" class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <!-- Resolving: the context is being fetched and there is no diff yet -->
    <template v-if="contextLoading && !scmChanges">
      <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin shrink-0" />
      <span>Looking for the change that broke this…</span>
    </template>

    <!-- A resolved diff: the range in one clause, and the way to the card -->
    <template v-else-if="summary">
      <span>{{ summary }}</span>
      <button type="button" :class="SENTENCE_LINK_CLASS" @click="emit('see')">See the changes</button>
    </template>

    <!-- A hand-picked range whose diff did not resolve: the card holds the picker -->
    <template v-else-if="hasChangesToShow">
      <span>{{ scmStatus.text }}</span>
      <span v-if="scmStatus.detail" class="text-muted">— {{ scmStatus.detail }}</span>
      <button type="button" :class="SENTENCE_LINK_CLASS" @click="emit('see')">Change the range</button>
    </template>

    <!-- Nothing to diff: why, and the browser where it can work -->
    <template v-else>
      <template v-if="coverage && scmHealthy">
        <span>No commits since {{ baseline }}</span>
      </template>
      <template v-else-if="coverage">
        <span>{{ scmStatus.text }}</span>
        <span v-if="scmStatus.detail" class="text-muted">— {{ scmStatus.detail }}</span>
      </template>
      <span v-else>Not available</span>
      <UButton
        v-if="canBrowse"
        size="xs"
        variant="ghost"
        color="neutral"
        label="Browse commits"
        class="shrink-0"
        @click="commitBrowserOpen = true"
      />
      <CommitBrowserModal
        v-if="canBrowse"
        v-model:open="commitBrowserOpen"
        :cluster-id="clusterId"
        :initial-selected="selectedCommitShas"
        :auto-selected-shas="autoSelectedCommits"
        @confirm="selectedCommitShas = $event"
      />
    </template>
  </p>
</template>
