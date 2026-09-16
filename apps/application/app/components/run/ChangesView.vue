<script setup lang="ts">
/**
 * What differs between this run and one baseline: the tests that started or
 * stopped failing, the ones that got slower or faster, the commits landed since
 * the baseline and the environment fields that moved. Every section reads the
 * same baseline — the automatic choice (same environment, then same branch,
 * then the base branch, then any), the base branch `?baseBranch=<name>` names,
 * or the run `?baseline=<runId>` names — so the "new failures" count is
 * computed once and reused everywhere. The selector says which run it is and
 * why it was chosen.
 */
import { computed, ref, watch } from 'vue';
import type { TestRunDetails, TestCaseResult, ProjectWithTestRuns } from '~~/types/api';
import type { RunInsightsResult } from '#shared/handlers/run-insights';
import { describeRunBaselineParts, type RunBaselinePart } from '#shared/run-baseline';

const props = defineProps<{
  testRun: TestRunDetails | null | undefined;
  /** This run's executions, so each changed test renders as a full TestRow. */
  testCases: TestCaseResult[];
  /** Resolved cluster names for the row chips. */
  clusterMeta?: Record<number, { name: string; status: string | null }>;
  projectKey?: string | number | null;
  projectName?: string | null;
  /** Increments when the run finishes so this tab can refetch. */
  refreshKey?: number;
}>();

const route = useRoute();
const router = useRouter();
const runId = Number(route.params.id);
const { copy, copied } = useCopy();

const isLive = computed(() => props.testRun?.status === 'running' || props.testRun?.status === 'finalizing');

// The explicit baseline run the URL asks for, or null for the automatic choice.
const baselineId = computed<number | null>(() => {
  const raw = route.query.baseline;
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
});

// The base branch the URL asks for: the baseline then comes from that branch only.
const baseBranch = computed<string | null>(() => {
  const raw = route.query.baseBranch;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
});

const data = ref<RunInsightsResult | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  if (!runId || isLive.value) {
    data.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const params = new URLSearchParams();
    if (baselineId.value != null) params.set('baseline', String(baselineId.value));
    else if (baseBranch.value) params.set('baseBranch', baseBranch.value);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    data.value = await $fetch<RunInsightsResult>(`/api/test-runs/${runId}/insights${query}`);
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Failed to load changes';
  } finally {
    loading.value = false;
  }
}

watch([() => props.testRun?.id, baselineId, baseBranch, () => props.refreshKey], load, { immediate: true });

// ── Baseline picker ─────────────────────────────────────────────────────────
const projectData = ref<ProjectWithTestRuns | null>(null);

watch(
  () => props.testRun?.projectId,
  async (projectId) => {
    if (!projectId || projectData.value) return;
    try {
      projectData.value = await $fetch<ProjectWithTestRuns>(`/api/projects/${projectId}`);
    } catch {
      // the picker falls back to Previous run only
    }
  },
  { immediate: true },
);

interface RunOption {
  label: string;
  value: number;
  branch: string | null;
  environment: string | null;
  date: string;
  status: string;
}

const runOptions = computed<RunOption[]>(() => {
  const runs = projectData.value?.testRuns;
  if (!runs) return [];
  return runs
    .filter((r) => r.id !== runId)
    .slice(0, 50)
    .map((r) => ({
      label: `Run #${r.id} · ${r.branch ?? 'no branch'} · ${r.environment ?? 'no environment'} · ${prettyDateFormat(r.startTime, { dateOnly: true })} (${r.status})`,
      value: r.id,
      branch: r.branch ?? null,
      environment: r.environment ?? null,
      date: prettyDateFormat(r.startTime, { dateOnly: true }),
      status: r.status,
    }));
});

// Base-branch choices: the automatic ladder, then every branch that has an
// earlier passing run. Offered only when a branch other than the run's own
// has one — otherwise there is nothing to choose.
const AUTO_BASE = '';
interface BaseBranchOption {
  label: string;
  value: string;
}
const baseBranchOptions = computed<BaseBranchOption[]>(() => {
  const d = data.value;
  if (!d || !d.baseBranches.some((b) => b !== d.run.branch)) return [];
  const own = d.run.branch;
  const fallback = d.fallbackBranch.branch;
  const ladder = !own ? 'most recent' : own === fallback ? own : `${own}, then ${fallback}`;
  const auto = { label: `Automatic (${ladder})`, value: AUTO_BASE };
  return [auto, ...d.baseBranches.map((b) => ({ label: b, value: b }))];
});

// The run immediately before this one, for the "Previous run" shortcut.
const previousRunId = computed<number | null>(() => {
  const runs = projectData.value?.testRuns;
  if (!runs || !props.testRun) return null;
  const sorted = [...runs].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const idx = sorted.findIndex((r) => r.id === runId);
  return idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1]!.id : null;
});

// Picking a run and picking a base branch are exclusive: the URL carries one.
function selectBaseline(id: number | null) {
  const query = { ...route.query };
  delete query.baseBranch;
  if (id == null) delete query.baseline;
  else query.baseline = String(id);
  router.replace({ query });
}

function selectBaseBranch(name: string | null) {
  const query = { ...route.query };
  delete query.baseline;
  if (!name) delete query.baseBranch;
  else query.baseBranch = name;
  router.replace({ query });
}

function resetBaseline() {
  selectBaseline(null);
}

const pickerValue = computed<RunOption | undefined>({
  get: () =>
    baselineId.value != null ? runOptions.value.find((o) => o.value === data.value?.baseline?.id) : undefined,
  set: (opt) => selectBaseline(opt?.value ?? null),
});

const baseBranchValue = computed<{ label: string; value: string } | undefined>({
  get: () => baseBranchOptions.value.find((o) => o.value === (baseBranch.value ?? AUTO_BASE)),
  set: (opt) => selectBaseBranch(opt?.value || null),
});

// Why this baseline, as parts, so branch and environment names carry their icon.
const noteParts = computed<RunBaselinePart[]>(() => {
  const d = data.value;
  if (!d?.hasBaseline || !d.baseline) return [];
  if (!d.baselineMatch) return [{ kind: 'text', text: d.baselineNote ?? 'The run you picked.' }];
  return describeRunBaselineParts({
    run: d.run,
    baseline: { branch: d.baseline.branch, environment: d.baseline.environment },
    match: d.baselineMatch,
    fallback: d.fallbackBranch,
  });
});

// ── Section data ─────────────────────────────────────────────────────────────
// Every changed test refers to an execution in this run, so its full row is in
// `testCases`; look it up by executionId to render a real TestRow.
const caseById = computed(() => {
  const map = new Map<number, TestCaseResult>();
  for (const tc of props.testCases) map.set(tc.executionId, tc);
  return map;
});

function rowsFor(entries: Array<{ executionId: number }> | undefined): TestCaseResult[] {
  if (!entries) return [];
  const seen = new Set<number>();
  const rows: TestCaseResult[] = [];
  for (const e of entries) {
    if (seen.has(e.executionId)) continue;
    const tc = caseById.value.get(e.executionId);
    if (tc) {
      seen.add(e.executionId);
      rows.push(tc);
    }
  }
  return rows;
}

const newFailureRows = computed(() => rowsFor(data.value?.newRegressions));
const fixedRows = computed(() => rowsFor(data.value?.recovered));
const stillFailingRows = computed(() => rowsFor(data.value?.recurrences));
// "Newly flaky" (was stable, now needs retries) and the wider "passed on retry"
// set share the same section; a test in both appears once.
const flakyRows = computed(() => rowsFor([...(data.value?.newFlaky ?? []), ...(data.value?.flakyOnRetry ?? [])]));

const hasDurationChanges = computed(
  () => (data.value?.mostRegressed.length ?? 0) > 0 || (data.value?.mostImproved.length ?? 0) > 0,
);

const hasAnyChange = computed(() => {
  const d = data.value;
  if (!d) return false;
  return (
    newFailureRows.value.length > 0 ||
    fixedRows.value.length > 0 ||
    stillFailingRows.value.length > 0 ||
    flakyRows.value.length > 0 ||
    hasDurationChanges.value ||
    d.commitRange != null ||
    d.metadataDiff.length > 0
  );
});

function clusterName(tc: TestCaseResult): string | null {
  return tc.failureClusterId != null ? (props.clusterMeta?.[tc.failureClusterId]?.name ?? null) : null;
}
</script>

<template>
  <div class="p-4">
    <ErrorState v-if="error" :text="error" padded>
      <template #action>
        <UButton size="sm" @click="load">Retry</UButton>
      </template>
    </ErrorState>

    <LoadingState v-else-if="loading" padded />

    <EmptyState v-else-if="isLive" icon="i-lucide-loader-circle" text="Run in progress">
      <p class="text-sm text-muted max-w-sm text-center">Changes are available once the run finishes.</p>
    </EmptyState>

    <EmptyState v-else-if="!data?.hasBaseline" icon="i-lucide-git-compare-arrows" text="No baseline run found">
      <p v-if="data?.baseBranch" class="text-sm text-muted max-w-sm text-center">
        No earlier passing run exists on <BranchLabel :name="data.baseBranch" copyable />. Pick another base branch, or
        go back to the automatic choice.
      </p>
      <p v-else class="text-sm text-muted max-w-sm text-center">
        Changes compare this run against the last passing run in the same environment — on the same branch, then the
        branch it forked from, then any branch. No earlier passing run exists yet; once the project has one, comparisons
        appear here.
      </p>
      <div v-if="baseBranchOptions.length > 0" class="flex flex-wrap items-center justify-center gap-2 mt-2">
        <USelectMenu
          v-model="baseBranchValue"
          :items="baseBranchOptions"
          size="xs"
          placeholder="Base branch…"
          class="w-64"
          title="Take the baseline from this branch only"
        >
          <template #default="{ modelValue: selected }">
            <BranchLabel v-if="selected?.value" :name="selected.value" />
            <span v-else class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-git-branch" class="size-3 shrink-0 text-muted" />
              {{ selected?.label ?? 'Base branch…' }}
            </span>
          </template>
          <template #item-label="{ item }">
            <BranchLabel v-if="item.value" :name="item.value" />
            <span v-else>{{ item.label }}</span>
          </template>
        </USelectMenu>
        <UButton
          v-if="data?.baselineSource !== 'auto'"
          size="xs"
          variant="outline"
          color="neutral"
          label="Automatic baseline"
          @click="resetBaseline"
        />
      </div>
    </EmptyState>

    <div v-else class="space-y-6" data-shot="run-changes">
      <!-- Baseline: which run, why, and the two ways to pick another -->
      <div class="space-y-2" data-shot="run-changes-baseline">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span class="text-muted inline-flex items-center gap-1">Compared with <HelpHint topic="run.changes" /></span>
          <NuxtLink
            :to="`/test-runs/${data.baseline!.id}`"
            class="font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            <RunStatusBadge :status="data.baseline!.status" />
            Run #{{ data.baseline!.id }}
          </NuxtLink>
          <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <BranchLabel :name="data.baseline!.branch" copyable />
            <EnvironmentBadge :name="data.baseline!.environment" />
            <span>{{ formatRelativeTime(data.baseline!.startTime) }}</span>
          </span>
        </div>
        <p class="text-xs text-muted leading-6">
          <template v-for="(part, i) in noteParts" :key="i">
            <BranchLabel v-if="part.kind === 'branch'" :name="part.name" copyable />
            <EnvironmentBadge v-else-if="part.kind === 'environment'" :name="part.name" inline />
            <template v-else>{{ part.text }}</template>
          </template>
          <template v-if="data.run.branch || data.run.environment">
            This run is on <BranchLabel :name="data.run.branch" copyable /> in
            <EnvironmentBadge :name="data.run.environment" inline />.
          </template>
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-medium text-muted">Base branch</span>
          <USelectMenu
            v-if="baseBranchOptions.length > 0"
            v-model="baseBranchValue"
            :items="baseBranchOptions"
            size="xs"
            class="w-64"
            title="Take the baseline from this branch only"
          >
            <template #default="{ modelValue: selected }">
              <BranchLabel v-if="selected?.value" :name="selected.value" />
              <span v-else class="inline-flex items-center gap-1.5 min-w-0">
                <UIcon name="i-lucide-git-branch" class="size-3 shrink-0 text-muted" />
                <span class="truncate">{{ selected?.label ?? 'Automatic' }}</span>
              </span>
            </template>
            <template #item-label="{ item }">
              <BranchLabel v-if="item.value" :name="item.value" />
              <span v-else>{{ item.label }}</span>
            </template>
          </USelectMenu>
          <span v-else class="inline-flex items-center gap-1 text-xs text-muted">
            <BranchLabel :name="data.fallbackBranch.branch" copyable /> (no other branch has a passing run yet)
          </span>
          <span class="text-xs font-medium text-muted ml-2">Run</span>
          <USelectMenu
            v-model="pickerValue"
            :items="runOptions"
            size="xs"
            placeholder="Pick a run…"
            class="w-80"
            title="Compare against one specific run"
          >
            <template #default="{ modelValue: selected }">
              <span v-if="selected" class="inline-flex items-center gap-2 min-w-0">
                <span class="shrink-0">Run #{{ selected.value }}</span>
                <BranchLabel :name="selected.branch" />
                <EnvironmentBadge :name="selected.environment" />
              </span>
              <span v-else class="text-muted">Pick a run…</span>
            </template>
            <template #item-label="{ item }">
              <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <span class="shrink-0">Run #{{ item.value }}</span>
                <BranchLabel :name="item.branch" />
                <EnvironmentBadge :name="item.environment" />
                <span class="text-xs text-muted">{{ item.date }} ({{ item.status }})</span>
              </span>
            </template>
          </USelectMenu>
          <UButton
            v-if="previousRunId && previousRunId !== data.baseline!.id"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-arrow-left"
            label="Previous run"
            @click="selectBaseline(previousRunId)"
          />
          <UButton
            v-if="data.baselineSource !== 'auto'"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-rotate-ccw"
            label="Automatic"
            title="Back to the automatic baseline"
            @click="resetBaseline"
          />
        </div>
      </div>

      <EmptyState v-if="!hasAnyChange" icon="i-lucide-equal" text="No changes against the baseline">
        <p class="text-sm text-muted max-w-sm text-center">
          The same tests passed and failed, at the same durations, with no commits or environment changes recorded
          between the two runs.
        </p>
      </EmptyState>

      <!-- New failures -->
      <SectionCard
        v-if="newFailureRows.length > 0"
        icon="i-lucide-alert-circle"
        icon-class="text-red-500"
        title="New failures"
        :count="data.newFailures"
        subtitle="Passed in the baseline, failing here"
      >
        <div class="-m-4">
          <TestRow
            v-for="tc in newFailureRows"
            :key="tc.executionId"
            :test-case="tc"
            :cluster-name="clusterName(tc)"
            :project-key="projectKey"
            :project-name="projectName"
          />
        </div>
      </SectionCard>

      <!-- Fixed -->
      <SectionCard
        v-if="fixedRows.length > 0"
        icon="i-lucide-check-circle"
        icon-class="text-green-500"
        title="Fixed"
        :count="fixedRows.length"
        subtitle="Failed in the baseline, passing here"
      >
        <div class="-m-4">
          <TestRow
            v-for="tc in fixedRows"
            :key="tc.executionId"
            :test-case="tc"
            :cluster-name="clusterName(tc)"
            :project-key="projectKey"
            :project-name="projectName"
          />
        </div>
      </SectionCard>

      <!-- Still failing -->
      <SectionCard
        v-if="stillFailingRows.length > 0"
        icon="i-lucide-refresh-cw"
        icon-class="text-amber-500"
        title="Still failing"
        :count="stillFailingRows.length"
        subtitle="Failing in both the baseline and this run"
      >
        <div class="-m-4">
          <TestRow
            v-for="tc in stillFailingRows"
            :key="tc.executionId"
            :test-case="tc"
            :cluster-name="clusterName(tc)"
            :project-key="projectKey"
            :project-name="projectName"
          />
        </div>
      </SectionCard>

      <!-- Newly flaky / passed on retry -->
      <SectionCard
        v-if="flakyRows.length > 0"
        icon="i-lucide-flask-conical"
        icon-class="text-purple-500"
        title="Newly flaky / passed on retry"
        :count="flakyRows.length"
        subtitle="Passed, but needed a retry"
      >
        <div class="-m-4">
          <TestRow
            v-for="tc in flakyRows"
            :key="tc.executionId"
            :test-case="tc"
            :cluster-name="clusterName(tc)"
            :project-key="projectKey"
            :project-name="projectName"
          />
        </div>
      </SectionCard>

      <!-- Slower / faster -->
      <SectionCard
        v-if="hasDurationChanges"
        icon="i-lucide-gauge"
        icon-class="text-blue-500"
        title="Slower / faster"
        subtitle="Duration change on tests that passed in both runs"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div v-if="data.mostRegressed.length > 0">
            <p class="text-xs font-medium text-red-500 mb-2">Slower</p>
            <div class="divide-y divide-default">
              <NuxtLink
                v-for="r in data.mostRegressed"
                :key="r.executionId"
                :to="`/test-run-cases/${r.executionId}?tab=performance`"
                class="flex items-center gap-2 py-1.5 text-sm hover:bg-elevated/50 rounded px-1 -mx-1"
              >
                <span class="text-red-500 font-mono shrink-0 tabular-nums">+{{ r.pctChange }}%</span>
                <span class="truncate text-highlighted hover:underline min-w-0">{{ r.title }}</span>
                <span class="ml-auto shrink-0 text-xs text-muted tabular-nums">
                  <DurationValue :ms="r.durationBefore" /> → <DurationValue :ms="r.durationAfter" />
                </span>
              </NuxtLink>
            </div>
          </div>
          <div v-if="data.mostImproved.length > 0">
            <p class="text-xs font-medium text-green-600 mb-2">Faster</p>
            <div class="divide-y divide-default">
              <NuxtLink
                v-for="i in data.mostImproved"
                :key="i.executionId"
                :to="`/test-run-cases/${i.executionId}?tab=performance`"
                class="flex items-center gap-2 py-1.5 text-sm hover:bg-elevated/50 rounded px-1 -mx-1"
              >
                <span class="text-green-600 font-mono shrink-0 tabular-nums">{{ i.pctChange }}%</span>
                <span class="truncate text-highlighted hover:underline min-w-0">{{ i.title }}</span>
                <span class="ml-auto shrink-0 text-xs text-muted tabular-nums">
                  <DurationValue :ms="i.durationBefore" /> → <DurationValue :ms="i.durationAfter" />
                </span>
              </NuxtLink>
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Commits since the baseline -->
      <SectionCard
        v-if="data.commitRange"
        icon="i-lucide-git-commit-horizontal"
        icon-class="text-gray-500"
        title="Commits since the baseline"
      >
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2 text-sm font-mono">
            <UBadge color="success" variant="soft" size="sm">{{ data.commitRange.fromShort }}</UBadge>
            <UIcon name="i-lucide-arrow-right" class="size-3 text-muted" />
            <UBadge color="error" variant="soft" size="sm">{{ data.commitRange.toShort }}</UBadge>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-if="data.commitRange.compareUrl"
              :to="data.commitRange.compareUrl"
              target="_blank"
              external
              icon="i-lucide-external-link"
              size="sm"
              variant="soft"
              color="primary"
              label="View commits"
            />
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <code class="flex-1 text-xs bg-elevated px-3 py-1.5 rounded font-mono truncate select-all">{{
                data.commitRange.gitCommand
              }}</code>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                size="xs"
                color="neutral"
                variant="ghost"
                :title="copied ? 'Copied' : 'Copy git command'"
                @click="copy(data.commitRange.gitCommand)"
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <!-- Environment changes -->
      <SectionCard
        v-if="data.metadataDiff.length > 0"
        icon="i-lucide-sliders-horizontal"
        icon-class="text-gray-500"
        title="Environment changes"
      >
        <TableScroller min-width="32rem" :bleed="false">
          <table class="w-full min-w-[32rem] text-sm">
            <thead>
              <tr class="text-xs text-muted uppercase tracking-wider border-b border-default">
                <th class="text-left px-3 py-2 font-medium w-32">Field</th>
                <th class="text-left px-3 py-2 font-medium">This run</th>
                <th class="text-left px-3 py-2 font-medium">Baseline</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in data.metadataDiff" :key="entry.key" class="border-b last:border-b-0 border-default">
                <td class="px-3 py-2 text-muted">{{ entry.label }}</td>
                <td class="px-3 py-2 font-mono text-xs">
                  <span v-if="entry.after" class="text-red-700 dark:text-red-400">{{ entry.after }}</span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td class="px-3 py-2 font-mono text-xs">
                  <span v-if="entry.before" class="text-green-700 dark:text-green-400">{{ entry.before }}</span>
                  <span v-else class="text-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </TableScroller>
      </SectionCard>
    </div>
  </div>
</template>
