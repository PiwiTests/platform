<script setup lang="ts">
/**
 * The "What changed" line of the cluster page's situation block: one sentence on
 * the commits between the last passing run and this failure. With a resolved
 * diff or a hand-picked commit range it sums the range up — commits, files, what
 * they are counted from — and links to the full card below the block, where the
 * baseline picker, the commits and the diff live. With nothing to diff it says
 * why and what fills the gap (a token, the reporter's Git metadata), keeps the
 * range usable where it is known — the host's compare page, the local `git log`
 * — and offers the commit browser where one can work, so a cluster without a
 * baseline is not a dead end: picking commits opens the card.
 */
import { docsUrl } from '#shared/docs';

const { clusterId, coverage, scmChanges, selectedCommitShas, autoSelectedCommits, contextLoading, hasChangesToShow } =
  useClusterDiagnosis();

const emit = defineEmits<{
  /** "See the changes" — the page scrolls to the card below the block. */
  see: [];
}>();

const { canSeeAdmin } = useAuth();
const { copy, copied } = useCopy();
const status = computed(() => describeScmStatus(coverage.value?.scm));
const commitBrowserOpen = ref(false);

// The browser lists the repository's commits, which needs a repository the run
// reported and a host we support: with a last passing run the server has said
// which; without one it has not looked, so the browser gets its chance.
const canBrowse = computed(() => {
  const scm = coverage.value?.scm;
  if (!scm || status.value.kind === 'no-repository' || status.value.kind === 'unsupported-host') return false;
  return Boolean(scm.provider || !scm.hasLastGreen);
});

/** Where the reporter's Git metadata is documented, when the runs lack it. */
const metadataDocs = computed(() =>
  status.value.kind === 'no-commit' || status.value.kind === 'no-repository'
    ? docsUrl('reference/test-metadata#scm-information-git')
    : null,
);

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What the range is counted from: the last passing run, the test's own last pass, or the baseline picked. */
const baseline = computed(() => {
  const scm = coverage.value?.scm;
  if (scm?.baseCommitUsed && scm.baselineKind === 'test-green') return 'this test last passed';
  return scm?.baseCommitUsed ? `baseline ${scm.baseCommitUsed.slice(0, 7)}` : 'the last passing run';
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
      <span>
        {{ status.text }}
        <span v-if="status.detail" class="text-muted" :title="status.error ?? undefined">— {{ status.detail }}</span>
      </span>
      <button type="button" :class="SENTENCE_LINK_CLASS" @click="emit('see')">Change the range</button>
    </template>

    <!-- Nothing to diff: why, what fills the gap, and the range where it is known -->
    <template v-else>
      <span>
        {{ status.text }}
        <span v-if="status.detail" class="text-muted" :title="status.error ?? undefined">— {{ status.detail }}</span>
      </span>
      <NuxtLink v-if="status.needsToken && canSeeAdmin" to="/settings/ai" :class="SENTENCE_LINK_CLASS">
        Add a token
      </NuxtLink>
      <a v-if="metadataDocs" :href="metadataDocs" target="_blank" rel="noopener" :class="SENTENCE_LINK_CLASS">
        How runs record Git
      </a>
      <a
        v-if="status.compare"
        :href="status.compare.url"
        target="_blank"
        rel="noopener"
        :class="SENTENCE_LINK_CLASS"
        data-testid="what-changed-compare"
      >
        {{ status.compare.label }}
      </a>
      <UButton
        v-if="status.gitCommand"
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="copied ? 'i-lucide-check' : undefined"
        :label="copied ? 'Copied' : 'Copy git log'"
        :title="status.gitCommand"
        class="shrink-0"
        data-testid="what-changed-git-log"
        @click="copy(status.gitCommand)"
      />
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
